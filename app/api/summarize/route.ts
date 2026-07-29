import { convertToModelMessages, generateText, UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

export const maxDuration = 60;

const MODELS: Record<string, string> = {
  instant: "JustScriptzz/kimi-k2.6",
  expert: "JustScriptzz/kimi-k2.6-thinking",
};

export async function POST(req: Request) {
  const { messages, model: modelKey = "instant" }: { messages: UIMessage[]; model?: string } =
    await req.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages are required." }, { status: 400 });
  }

  const client = createOpenAI({
    baseURL: "https://gen.pollinations.ai/v1",
    apiKey: process.env.POLLINATIONS_API_KEY,
  });
  const result = await generateText({
    model: client.chat(MODELS[modelKey] ?? MODELS.instant),
    system: "You maintain long-running conversation memory for NOVA. Summarize the supplied conversation so it can replace older messages as private context. Preserve the user's goals, relevant background, decisions, constraints, unresolved questions, and important facts. Do not address the user, add new information, or mention that a summary was made. Be concise but specific.",
    messages: await convertToModelMessages(messages),
  });

  return Response.json({ summary: result.text.trim() });
}
