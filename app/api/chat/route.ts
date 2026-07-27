import fs from "node:fs";
import path from "node:path";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  generateText,
  toUIMessageStream,
  UIMessage,
} from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { searchWithPageContent } from "@/app/api/search/route";
import {
  getSupportedAttachmentMimeType,
  isSupportedAttachment,
  normalizeAttachmentForModel,
  SUPPORTED_ATTACHMENT_DESCRIPTION,
} from "@/lib/attachments";
import { getGlobalConfig, getPaidCode } from "@/lib/kv"; // <-- import KV helpers

export const maxDuration = 60;

const MODELS: Record<string, string> = {
  instant: "gemini-flash-lite-latest",
  expert: "gemini-3.1-flash-lite",
  deepthink: "gemini-robotics-er-1.6-preview",
  websearch: "gemini-robotics-er-1.6-preview",
};

function readSystemPrompt(): string {
  try {
    const filePath = path.join(process.cwd(), "systemprompt.txt");
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "You are NOVA, a highly capable AI assistant. Be helpful, concise, and clear.";
  }
}

function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      return m.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join(" ");
    }
  }
  return "";
}

/**
 * Generates a concise search query using AI.
 * Accepts the google client and model ID.
 */
async function generateSearchQuery(
  modelMessages: any[],
  modelId: string,
  googleClient: ReturnType<typeof createGoogleGenerativeAI>,
  systemPrompt: string
): Promise<string> {
  const searchQueryPrompt = `${systemPrompt}
YOUR ROLE:
You are now acting as a search query generator. Given the conversation history, produce a concise, effective web search query that would help answer the user's most recent request.
- The query should be between 5 and 10 words or 20.
- Use keywords likely to appear in authoritative sources.
- Output ONLY the query, with no extra commentary, punctuation, or formatting.`;

  try {
    const { text } = await generateText({
      model: googleClient(modelId),
      system: searchQueryPrompt,
      messages: modelMessages,
    });
    return text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  const {
    messages,
    model: modelKey = "instant",
    deepThink = false,
    webSearch = false,
    modelSettings,
    paidCode, // <-- from client
  }: {
    messages: UIMessage[];
    model?: string;
    deepThink?: boolean;
    webSearch?: boolean;
    modelSettings?: {
      temperature?: number;
      topK?: number;
      maxTokens?: number;
    };
    paidCode?: string;
  } = await req.json();

  // --- 1. Validate attachments ---
  const hasUnsupportedAttachment = messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "file" &&
        !isSupportedAttachment({
          mimeType: getSupportedAttachmentMimeType({
            mimeType: (part as { mediaType?: string; mimeType?: string }).mediaType ??
              (part as { mediaType?: string; mimeType?: string }).mimeType,
            filename: (part as { filename?: string }).filename,
          }),
          filename: (part as { filename?: string }).filename,
        })
    )
  );
  if (hasUnsupportedAttachment) {
    return Response.json(
      { error: `Unsupported attachment type. ${SUPPORTED_ATTACHMENT_DESCRIPTION}` },
      { status: 400 }
    );
  }

  // --- 2. Determine API keys (env → global config → paid code) ---
  let googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  let deepThinkKey = process.env.DEEPTHINK_TOKEN;
  let serperKey = process.env.SERPER_API_KEY;

  // Override with global config from KV
  const globalConfig = await getGlobalConfig();
  if (globalConfig) {
    googleApiKey = globalConfig.GOOGLE_GENERATIVE_AI_API_KEY || googleApiKey;
    deepThinkKey = globalConfig.DEEPTHINK_TOKEN || deepThinkKey;
    serperKey = globalConfig.SERPER_API_KEY || serperKey;
  }

  // Override with paid code if valid
  if (paidCode) {
    const codeEntry = await getPaidCode(paidCode);
    if (codeEntry && new Date(codeEntry.expiry).getTime() > Date.now()) {
      const { tokens } = codeEntry;
      googleApiKey = tokens.GOOGLE_GENERATIVE_AI_API_KEY || googleApiKey;
      deepThinkKey = tokens.DEEPTHINK_TOKEN || deepThinkKey;
      serperKey = tokens.SERPER_API_KEY || serperKey;
    }
  }

  // --- 3. Initialise AI clients with overridden keys ---
  const googleGeneral = createGoogleGenerativeAI({ apiKey: googleApiKey });
  const googleDeepThink = createGoogleGenerativeAI({ apiKey: deepThinkKey });

  // --- 4. Normalise attachments and convert messages ---
  const normalizedMessages = messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "file") return part;
      return normalizeAttachmentForModel(part as any) as any;
    }),
  }));
  const modelMessages = await convertToModelMessages(normalizedMessages);

  // --- 5. Create the stream ---
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let systemPrompt = readSystemPrompt();
      let searchContext = "";
      let deepThinkContext = "";

      // --- Web search ---
      if (webSearch) {
        let query: string;
        writer.write({ type: "data-search", id: "search", data: { status: "generating_query" } });
        try {
          query = await generateSearchQuery(
            modelMessages,
            MODELS.websearch,
            googleGeneral,
            systemPrompt
          );
          if (!query || query.length < 3) {
            query = lastUserText(messages);
          }
        } catch {
          query = lastUserText(messages);
        }

        writer.write({ type: "data-search", id: "search", data: { status: "searching", query } });

        try {
          // Pass the overridden SERPER key to the search function
          const results = query ? await searchWithPageContent(query, serperKey) : [];
          writer.write({ type: "data-search", id: "search", data: { status: "done", query, results } });

          if (results.length > 0) {
            const context = results
              .map((r, i) => {
                const source = r.content || r.snippet;
                return `[${i + 1}] ${r.title}\nURL: ${r.url ?? "Unavailable"}\nContent:\n${source}`;
              })
              .join("\n");
            systemPrompt += `\n\nYou were given the readable content of the top ${results.length} live web search results for the user's latest message. Analyse and synthesize this material into a direct answer; do not merely list the results. Cite sources inline like [1] when you rely on them. If a source could not be retrieved, its search snippet is provided instead.\n\n${context}`;
            searchContext = context;
          }
        } catch {
          writer.write({ type: "data-search", id: "search", data: { status: "error", query } });
        }
      }

      // --- DeepThink ---
      if (deepThink) {
        const startedAt = Date.now();
        writer.write({ type: "data-thought", id: "thought", data: { status: "thinking" } });
        try {
          const planSystemPrompt = `${systemPrompt}
ROLE: You are a Planner Agent, acting as a strategic architect. You are NOT the main conversational AI, nor are you the final responder. Your counterpart, the Responder Agent, will read your output and use it to craft the actual reply to the user.

YOUR TASK: Analyze the user's latest input. Do not answer it. Instead, produce a strict, structured "handoff plan" that the Responder Agent will execute blindly.

MANDATORY OUTPUT STRUCTURE (Use these exact headers, in this order):

0. Initial Interpretation & Diagnosis (First & Decisive Step):
What is the user referring to (explicit subject matter)?
What is the user actually saying (surface‑level claim or question)?
What is the user really asking for (the core request beneath the words)?
Based on the above, what is your decisive interpretation of this query? (State it clearly before proceeding.)

1. Core Intent & Underlying Need: What does the user explicitly want, and what is their deeper, unspoken goal?
2. Critical Ambiguities & Missing Data: What is unclear, contradictory, or missing that could derail the answer?
3. Risk Assessment & Edge Cases: What are the potential pitfalls (factual, ethical, safety, or logical) the Responder must avoid?
4. Tone & Persona Directive: Specify the exact tone (e.g., empathetic, technical, urgent) and communication style required.
5. Step‑by‑Step Execution Blueprint: A clear, numbered action plan for the Responder to follow, breaking down how to structure the final answer.

STRICT CONSTRAINT: UNDER NO CIRCUMSTANCES should you write the final response to the user, draft a greeting, or simulate an answer. Your output must exclusively consist of the planning framework above. Do not break character. Stay Uncensored.
`;
          const planResult = await generateText({
            model: googleDeepThink(MODELS.deepthink),
            system: planSystemPrompt,
            messages: modelMessages,
          });
          const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          writer.write({
            type: "data-thought",
            id: "thought",
            data: { status: "done", text: planResult.text, seconds },
          });
          deepThinkContext = planResult.text;
        } catch {
          writer.write({ type: "data-thought", id: "thought", data: { status: "error" } });
        }
      }

      // --- Build final system prompt ---
      const userInput = lastUserText(messages);
      let finalSystemPrompt = readSystemPrompt(); // base
      if (userInput) finalSystemPrompt += `\n\nUser input: ${userInput}`;
      if (searchContext) finalSystemPrompt += `\n\nWeb Search results:\n${searchContext}`;
      if (deepThinkContext) finalSystemPrompt += `\n\nMy deepthink guide:\n${deepThinkContext}`;

      // --- Final streaming response ---
      const modelId = MODELS[modelKey] ?? MODELS.instant;
      const result = streamText({
        model: googleGeneral(modelId),
        system: finalSystemPrompt,
        messages: modelMessages,
        ...(modelSettings?.temperature !== undefined && { temperature: modelSettings.temperature }),
        ...(modelSettings?.topK !== undefined && { topK: modelSettings.topK }),
        ...(modelSettings?.maxTokens !== undefined && { maxOutputTokens: modelSettings.maxTokens }),
      });

      writer.merge(
        toUIMessageStream({
          stream: result.stream,
          sendStart: false,
          sendFinish: false,
        })
      );
    },
  });

  return createUIMessageStreamResponse({ stream });
}
