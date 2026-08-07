import { convertToModelMessages, streamText, UIMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

export const maxDuration = 60;

const MODELS: Record<string, string> = {
  instant: "deepseek/deepseek-chat",
  expert: "deepseek/deepseek-chat",
};

function getServerEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function parseAuthHeaderTemplate(template: string, apiKey?: string): Record<string, string> | undefined {
  const headerValue = apiKey
    ? template.replace(/\{API_KEY\}/gi, apiKey).trim()
    : template.trim();
  const separatorIndex = headerValue.indexOf(":");
  if (separatorIndex < 0) return undefined;

  const name = headerValue.slice(0, separatorIndex).trim();
  const value = headerValue.slice(separatorIndex + 1).trim();
  if (!name || !value) return undefined;

  return { [name]: value };
}

function createCustomFetch(customHeaders: Record<string, string>) {
  return async (input: string | Request | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    headers.delete("authorization");
    for (const [key, value] of Object.entries(customHeaders)) {
      headers.set(key, value);
    }

    const requestInit: RequestInit = {
      ...init,
      headers,
      body: request.body,
      method: request.method,
      signal: request.signal,
    };

    return fetch(request.url, requestInit);
  };
}

export async function POST(req: Request) {
  const { messages, model: modelKey = "instant" }: { messages: UIMessage[]; model?: string } =
    await req.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages are required." }, { status: 400 });
  }

  const openaiBaseURL = getServerEnvValue("BASED_URL", "BASE_URL", "BLOCKRUN_BASE_URL", "OPENAI_BASE_URL");
  const openaiAuthHeader = getServerEnvValue("BLOCKRUN_AUTH_HEADER", "OPENAI_AUTH_HEADER", "AUTH_HEADER");
  const apiKey = process.env.BLOCKRUN_API_KEY ?? process.env.OPENAI_API_KEY;
  const customHeaders = openaiAuthHeader && apiKey ? parseAuthHeaderTemplate(openaiAuthHeader, apiKey) : undefined;
  const customFetch = customHeaders ? createCustomFetch(customHeaders) : undefined;

  const openAIOptions = {
    baseURL: openaiBaseURL,
    headers: customHeaders,
    fetch: customFetch,
    apiKey: customHeaders ? undefined : apiKey ?? "blockrun",
  };

  const client = createOpenAI(openAIOptions);
  // This provider always returns SSE streaming, even without stream: true,
  // so use streamText instead of generateText to consume the stream.
  const result = streamText({
    model: client.chat(MODELS[modelKey] ?? MODELS.instant),
    system: "You maintain long-running conversation memory for NOVA. Summarize the supplied conversation so it can replace older messages as private context. Preserve the user's goals, relevant background, decisions, constraints, unresolved questions, and important facts. Do not address the user, add new information, or mention that a summary was made. Be concise but specific.",
    messages: await convertToModelMessages(messages),
  });

  let summary = "";
  for await (const delta of result.textStream) {
    summary += delta;
  }

  return Response.json({ summary: summary.trim() });
}
