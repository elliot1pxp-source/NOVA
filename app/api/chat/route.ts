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

  const modelMessages = await convertToModelMessages(messages);

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      let systemPrompt = baseSystemPrompt;

      // --- Web search (uses searchWithPageContent from the search route) ---
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

      // --- DeepThink (uses the separate DEEPTHINK_TOKEN) ---
      if (deepThink) {
        const startedAt = Date.now();
        writer.write({ type: "data-thought", id: "thought", data: { status: "thinking" } });
        try {
          const planSystemPrompt = `${systemPrompt}

You are the planning stage of an AI assistant called NOVA. Do not answer the user directly. Instead, think step by step about what the user needs, break the problem down, note any risks or ambiguities, and outline a clear plan for how to answer well. Be brief but thorough. This plan will be handed to another step that writes the final answer.`;

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
