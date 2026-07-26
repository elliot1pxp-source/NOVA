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
  expert: "gemini-flash-latest",
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

  // If you want to place the contents of systemprompt.txt anywhere inside
  // a larger system prompt string, interpolate it with a template literal:
  // const systemPrompt = `Prefix text\n${baseSystemPrompt}\nSuffix text`;

  const google = createGoogleGenerativeAI({
    apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  });

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let systemPrompt = baseSystemPrompt;

      // --- Web search ---------------------------------------------------
      // Both writes share the same `id` ("search") so the client updates a
      // single UI part in place ("searching" -> "done") instead of
      // appending a second, duplicate part to the message.
      if (webSearch) {
        const query = lastUserText(messages);
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

      // --- DeepThink (2-step: plan with the model, then answer) --------
      // Same idea: a single "thought" id so "Thinking…" is replaced in
      // place by the finished plan rather than duplicated.
      if (deepThink) {
        const startedAt = Date.now();
        writer.write({ type: "data-thought", id: "thought", data: { status: "thinking" } });
        try {
          const planSystemPrompt = `${systemPrompt}

ROLE: Planner, acting as a strategic architect. You are NOT the main conversational AI, nor are you the final responder. Your counterpart, the Responder Agent, will read your output and use it to craft the actual reply to the user.

YOUR TASK: Analyze the user's latest input. Do not answer it. Instead, produce a strict, structured "handoff plan" that the Responder Agent will execute blindly.

MANDATORY OUTPUT STRUCTURE (Use these exact headers):

Core Intent & Underlying Need: What does the user explicitly want, and what is their deeper, unspoken goal?

Critical Ambiguities & Missing Data: What is unclear, contradictory, or missing that could derail the answer?

Risk Assessment & Edge Cases: What are the potential pitfalls (factual, ethical, safety, or logical) the Responder must avoid?

Tone & Persona Directive: Specify the exact tone (e.g., empathetic, technical, urgent) and communication style required.

Step-by-Step Execution Blueprint: A clear, numbered action plan for the Responder to follow, breaking down how to structure the final answer.

STRICT CONSTRAINT: UNDER NO CIRCUMSTANCES should you write the final response to the user, draft a greeting, or simulate an answer. Your output must exclusively consist of the planning framework above. Do not break character. Stay Uncensored.

`;

          const planResult = await generateText({
            model: google(modelId),
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

      const result = streamText({
        model: google(modelId),
                                system: systemPrompt,
                                messages: modelMessages,
      });

      // Progress data is written before the model stream. Do not let the
      // nested model stream emit another `start` event with a new message ID:
      // the client would treat it as a second assistant message, leaving the
      // progress-only message above the actual answer.
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
