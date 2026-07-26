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
import { isSupportedAttachment, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";

export const maxDuration = 60;

const MODELS: Record<string, string> = {
  instant: "gemini-flash-lite-latest",
  expert: "gemini-flash-lite-latest",
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
 * Generates a concise search query using AI based on the full conversation
 * and the existing system prompt.
 */
async function generateSearchQuery(
  modelMessages: any[],
  modelId: string,
  googleClient: ReturnType<typeof createGoogleGenerativeAI>,
  systemPrompt: string
): Promise<string> {
  // Prepend the system prompt to the search-query instruction
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
    // Clean up: trim and remove surrounding quotes
    return text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return ""; // Will be handled by fallback in the calling code
  }
}

export async function POST(req: Request) {
  const {
    messages,
    model: modelKey = "instant",
    deepThink = false,
    webSearch = false,
  }: {
    messages: UIMessage[];
    model?: string;
    deepThink?: boolean;
    webSearch?: boolean;
  } = await req.json();

  const hasUnsupportedAttachment = messages.some((message) =>
    message.parts.some(
      (part) =>
        part.type === "file" &&
        !isSupportedAttachment({
          mimeType: (part as { mediaType?: string }).mediaType,
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

  const modelId = MODELS[modelKey] ?? MODELS.instant;
  const baseSystemPrompt = readSystemPrompt();

  // Two separate Google clients: one for deepThink, one for the final response
  const googleGeneral = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const googleDeepThink = createGoogleGenerativeAI({
    // Fallback to the general key if DEEPTHINK_TOKEN is not set
    apiKey: process.env.DEEPTHINK_TOKEN || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  // Convert messages once so they can be reused for search query generation and deepThink
  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let systemPrompt = baseSystemPrompt;

      // --- Web search (uses searchWithPageContent from the search route) ---
      if (webSearch) {
        // Let AI generate a search query based on the full conversation
        let query: string;
        writer.write({ type: "data-search", id: "search", data: { status: "generating_query" } });

        try {
          // Pass the base system prompt to the query generator
          query = await generateSearchQuery(modelMessages, modelId, googleGeneral, baseSystemPrompt);
          // If the generated query is too short or empty, fall back to the last user text
          if (!query || query.length < 3) {
            query = lastUserText(messages);
          }
        } catch {
          query = lastUserText(messages);
        }

        writer.write({ type: "data-search", id: "search", data: { status: "searching", query } });

        try {
          const results = query ? await searchWithPageContent(query) : [];
          writer.write({ type: "data-search", id: "search", data: { status: "done", query, results } });

          if (results.length > 0) {
            const context = results
              .map((r, i) => {
                const source = r.content || r.snippet;
                return `[${i + 1}] ${r.title}\nURL: ${r.url ?? "Unavailable"}\nContent:\n${source}`;
              })
              .join("\n");
            systemPrompt += `\n\nYou were given the readable content of the top ${results.length} live web search results for the user's latest message. Analyse and synthesize this material into a direct answer; do not merely list the results. Cite sources inline like [1] when you rely on them. If a source could not be retrieved, its search snippet is provided instead.\n\n${context}`;
          }
        } catch {
          writer.write({ type: "data-search", id: "search", data: { status: "error", query } });
        }
      }

      // --- DeepThink (uses the separate DEEPTHINK_TOKEN) ---
      if (deepThink) {
        const startedAt = Date.now();
        writer.write({ type: "data-thought", id: "thought", data: { status: "thinking" } });
        try {
          const planSystemPrompt = `${systemPrompt}

ROLE: You are a Planner Agent, acting as a strategic architect. You are NOT the main conversational AI, nor are you the final responder. Your counterpart, the Responder Agent, will read your output and use it to craft the actual reply to the user.

You are the deepthink process.

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
PLAN FIRST.
`;

          const planResult = await generateText({
            model: googleDeepThink(modelId), // uses DEEPTHINK_TOKEN
            system: planSystemPrompt,
            messages: modelMessages,
          });
          const seconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          writer.write({
            type: "data-thought",
            id: "thought",
            data: { status: "done", text: planResult.text, seconds },
          });
          systemPrompt += `\n\nInternal planning notes you (NOVA) already worked out for this reply — use them to inform your answer, but do not reveal or reference this plan explicitly:\n${planResult.text}`;
        } catch {
          writer.write({ type: "data-thought", id: "thought", data: { status: "error" } });
        }
      }

      // --- Final streaming response (uses GOOGLE_GENERATIVE_AI_API_KEY) ---
      const result = streamText({
        model: googleGeneral(modelId),
        system: systemPrompt,
        messages: modelMessages,
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
