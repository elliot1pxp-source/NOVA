/**
 * Shared LLM provider layer with a silent fail-over chain.
 *
 * Two OpenAI-compatible endpoints are supported:
 *   1. The primary endpoint (BASED_URL / BLOCKRUN_API_KEY).
 *   2. A fallback endpoint (FALLBACK_BASED_URL / FALLBACK_API_KEY).
 *
 * When a request to the primary endpoint fails (network error, retryable
 * server error, or a rejected request) BEFORE any response text has been
 * delivered, the call is transparently retried against the fallback endpoint,
 * then back to the primary, alternating (primary -> fallback -> primary ->
 * fallback). The switchover is silent: no user-visible changes, only server
 * logs.
 */
import {
  streamText,
  type TextStreamPart,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";

// Per-provider model mappings. The primary endpoint (BASED_URL) uses "oc/"
// prefixed model IDs; the fallback endpoint (FALLBACK_BASED_URL) uses 
// unprefixed IDs. Both expose the same logical models.

export const PRIMARY_MODELS: Record<string, string> = {
  instant: "oc/deepseek-v4-flash-free",
  expert: "oc/big-pickle",
  websearch: "oc/deepseek-v4-flash-free",
  fileAnalysis: "oc/deepseek-v4-flash-free",
};

export const FALLBACK_MODELS: Record<string, string> = {
  instant: "deepseek-v4-flash-free",
  expert: "big-pickle",
  websearch: "deepseek-v4-flash-free",
  fileAnalysis: "nemotron-3-ultra-free",
};

// Model role keys used by call sites. The fallback functions resolve each key
// to the correct per-provider model ID (PRIMARY_MODELS vs FALLBACK_MODELS).
export const MODELS: Record<string, string> = {
  instant: "instant",
  expert: "expert",
  websearch: "websearch",
  // Dedicated model used for per-file analysis sub-calls, decoupled from
  // whichever chat model the user has selected.
  fileAnalysis: "fileAnalysis",
};

// Which endpoint the file-analysis sub-calls should try first. Defaults to
// "primary"; set FILE_ANALYSIS_PROVIDER=fallback in the environment to flip
// it. The alternating fail-over chain still applies after the first attempt.
export type ProviderPreference = "primary" | "fallback";

export function getFileAnalysisProviderPreference(): ProviderPreference {
  const raw = getServerEnvValue("FILE_ANALYSIS_PROVIDER")?.toLowerCase();
  return raw === "fallback" ? "fallback" : "primary";
}

// How many alternating provider attempts to make before giving up:
//   default -> fallback -> default -> fallback  (4 attempts total)
export const MAX_FALLBACK_ATTEMPTS = 4;

// Internal retries per single provider attempt. The provider can report
// transient "capacity busy" errors; the AI SDK retries with exponential
// backoff inside each request.
export const MODEL_MAX_RETRIES = 3;

export function getServerEnvValue(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function parseAuthHeaderTemplate(
  template: string,
  apiKey?: string
): Record<string, string> | undefined {
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

/**
 * Extracts `reasoning_content` deltas from an SSE chat-completions stream so
 * the caller can surface the model's native reasoning text. The AI SDK's
 * chat-completions parser discards that field entirely, so the tee taps the
 * raw response body while the original bytes still flow through untouched.
 * Non-SSE bodies (e.g. JSON errors) pass through unchanged.
 */
function teeSseEvents(
  response: Response,
  onReasoningDelta: (text: string) => void
): Response {
  if (!response.body) return response;

  const decoder = new TextDecoder();
  let buffer = "";

  const findEventBoundary = (buf: string): number => {
    const doubleLf = buf.indexOf("\n\n");
    const crlf = buf.indexOf("\r\n\r\n");
    if (doubleLf < 0) return crlf;
    if (crlf < 0) return doubleLf;
    return Math.min(doubleLf, crlf);
  };

  const processEvent = (rawEvent: string) => {
    for (const line of rawEvent.split("\n")) {
      const trimmed = line.replace(/\r$/, "");
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trimStart();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { reasoning_content?: string | null } }>;
        };
        const reasoningText = parsed.choices?.[0]?.delta?.reasoning_content;
        if (typeof reasoningText === "string" && reasoningText.length > 0) {
          onReasoningDelta(reasoningText);
        }
      } catch {
        // Not a chat-completions SSE payload — ignore.
      }
    }
  };

  const transformer = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let boundary = findEventBoundary(buffer);
      while (boundary >= 0) {
        processEvent(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary).replace(/^(\r?\n)+/, "");
        boundary = findEventBoundary(buffer);
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer.trim()) {
        processEvent(buffer.replace(/^(\r?\n)+/, ""));
      }
    },
  });

  return new Response(response.body.pipeThrough(transformer), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function createCustomFetch(
  customHeaders: Record<string, string>,
  onReasoningDelta?: (text: string) => void
) {
  return async (input: string | Request | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    headers.delete("authorization");
    for (const [key, value] of Object.entries(customHeaders)) {
      headers.set(key, value);
    }

    const requestInit: NodeFetchRequestInit = {
      ...init,
      headers,
      body: request.body,
      method: request.method,
      signal: request.signal,
      // request.body is always a ReadableStream; Node's fetch requires the
      // duplex option when re-sending a streamed body.
      duplex: "half",
    };

    const response = await fetch(request.url, requestInit as RequestInit);
    if (!onReasoningDelta) return response;
    return teeSseEvents(response, onReasoningDelta);
  };
}

/** Fetch wrapper that only taps reasoning deltas (no auth header changes). */
function createReasoningTeeFetch(onReasoningDelta: (text: string) => void) {
  return async (input: string | Request | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await fetch(request.url, {
      ...init,
      body: request.body,
      method: request.method,
      signal: request.signal,
      // request.body is always a ReadableStream; Node's fetch requires the
      // duplex option when re-sending a streamed body.
      duplex: "half",
    } as NodeFetchRequestInit as RequestInit);
    return teeSseEvents(response, onReasoningDelta);
  };
}

export type ProviderClients = {
  /** Primary endpoint client (BASED_URL). */
  primary: ReturnType<typeof createOpenAI>;
  /** Fallback endpoint client (FALLBACK_BASED_URL). May be the primary if no fallback is configured. */
  fallback: ReturnType<typeof createOpenAI>;
  /** True when a distinct fallback endpoint + key is configured. */
  hasFallback: boolean;
};

// Node's fetch (undici) requires `duplex: "half"` when re-sending a streamed
// request body; the DOM RequestInit type doesn't include it.
type NodeFetchRequestInit = RequestInit & { duplex?: "half" };

/**
 * Builds both provider clients from environment configuration.
 *
 * AUTH_HEADER templates like "Authorization: Bearer {API_KEY}" are supported
 * for the primary endpoint; the fallback always uses a plain Bearer token.
 *
 * Pass `onReasoningDelta` to receive the model's native reasoning text
 * (`reasoning_content` SSE deltas) as it streams — the AI SDK discards it.
 * Only enable it on the client(s) serving the main response so progress parts
 * are not flooded by sub-calls.
 */
export function createProviderClients(
  apiKey?: string,
  options?: {
    onReasoningDelta?: (text: string) => void;
    primaryBaseURL?: string;
    fallbackBaseURL?: string;
    fallbackApiKey?: string;
  }
): ProviderClients {
  const onReasoningDelta = options?.onReasoningDelta;
  const primaryBaseURL =
    options?.primaryBaseURL ||
    getServerEnvValue(
      "BASED_URL",
      "BASE_URL",
      "BLOCKRUN_BASE_URL",
      "OPENAI_BASE_URL"
    );
  const primaryAuthHeader = getServerEnvValue(
    "BLOCKRUN_AUTH_HEADER",
    "OPENAI_AUTH_HEADER",
    "AUTH_HEADER"
  );
  const customPrimaryHeaders =
    primaryAuthHeader && apiKey
      ? parseAuthHeaderTemplate(primaryAuthHeader, apiKey)
      : undefined;
  // When no real key is configured, strip the Authorization header entirely
  // instead of letting the SDK send an empty/placeholder bearer. Proxies that
  // run REQUIRE_API_KEY=false then treat the request as intentionally
  // anonymous (no "invalid bearer" noise), and a future REQUIRE_API_KEY=true
  // fails loudly either way.
  let primaryFetch: ((input: string | Request | URL, init?: RequestInit) => Promise<Response>) | undefined;
  if (customPrimaryHeaders) {
    primaryFetch = createCustomFetch(customPrimaryHeaders, onReasoningDelta);
  } else if (!apiKey) {
    primaryFetch = createCustomFetch({}, onReasoningDelta);
  } else if (onReasoningDelta) {
    // Real key, no custom auth template, but reasoning tee requested — wrap
    // without touching the SDK's Authorization header.
    primaryFetch = createReasoningTeeFetch(onReasoningDelta);
  }

  const primary = createOpenAI({
    baseURL: primaryBaseURL,
    headers: customPrimaryHeaders,
    fetch: primaryFetch,
    // The SDK requires a string here; the custom fetch above strips it from
    // the wire when there is no real key.
    apiKey: customPrimaryHeaders ? undefined : apiKey ?? "blockrun",
  });

  const fallbackBaseURL =
    options?.fallbackBaseURL || getServerEnvValue("FALLBACK_BASED_URL");
  const fallbackApiKey =
    options?.fallbackApiKey || getServerEnvValue("FALLBACK_API_KEY");
  const hasFallback =
    Boolean(fallbackBaseURL && fallbackApiKey) && fallbackBaseURL !== primaryBaseURL;

  const fallback = hasFallback
    ? createOpenAI({
        baseURL: fallbackBaseURL,
        apiKey: fallbackApiKey ?? "fallback",
        ...(onReasoningDelta
          ? { fetch: createReasoningTeeFetch(onReasoningDelta) }
          : {}),
      })
    : primary;

  return { primary, fallback, hasFallback };
}

export type StreamingModelOptions = {
  temperature?: number;
  maxOutputTokens?: number;
};

export function getStreamingModelOptions(
  modelSettings?: { temperature?: number; topK?: number; maxTokens?: number }
): StreamingModelOptions {
  const options: StreamingModelOptions = {};

  if (modelSettings?.temperature !== undefined) {
    options.temperature = modelSettings.temperature;
  }

  if (modelSettings?.maxTokens !== undefined) {
    options.maxOutputTokens = modelSettings.maxTokens;
  }

  return options;
}

type StreamWithFallbackOptions = {
  modelId: string;
  system?: string;
  messages: NonNullable<Parameters<typeof streamText>[0]["messages"]>;
  modelSettings?: { temperature?: number; topK?: number; maxTokens?: number };
  /** Per-attempt internal retries (AI SDK maxRetries). */
  maxRetries?: number;
  /**
   * Native reasoning effort for the model. Maps to the standard
   * `reasoning_effort` body parameter on OpenAI-compatible endpoints (which
   * this provider layer targets). When set to a value other than "none", the
   * model uses its own built-in thinking instead of an external planner
   * sub-call. Accepted values follow the effort tiers the endpoints advertise.
   */
  reasoning?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Called for every text delta so the caller can filter content. */
  onTextDelta?: (text: string) => string;
  /** Optional runtime model map overrides for admin-configurable models. */
  primaryModels?: Record<string, string>;
  fallbackModels?: Record<string, string>;
  /**
   * Called exactly once, when the first non-empty text delta of the final
   * answer arrives (after any reasoning phase). Lets callers flip progress
   * parts from "thinking" to "done" at the right moment.
   */
  onFirstText?: () => void;
  /** Called with an Error whenever an attempt fails (for diagnostics only). */
  onAttemptError?: (error: unknown, attempt: number) => void;
  /** Called when the provider switches over (diagnostics only). */
  onProviderSwitch?: (from: "primary" | "fallback", attempt: number) => void;
  /** Called before each provider attempt so callers can reset accumulators. */
  onAttemptStart?: (attempt: number) => void;
  /**
   * Which endpoint the FIRST attempt should use. Defaults to "primary". The
   * alternating primary/fallback pattern still applies on retries, it's just
   * shifted to start on whichever endpoint is preferred.
   */
  startProvider?: ProviderPreference;
  abortSignal?: AbortSignal;
};

export function streamTextWithFallback(
  clients: ProviderClients,
  options: StreamWithFallbackOptions
): ReadableStream<TextStreamPart<any>> {
  const {
    modelId,
    system,
    messages,
    modelSettings,
    maxRetries = MODEL_MAX_RETRIES,
    reasoning,
    onTextDelta,
    onFirstText,
    onAttemptError,
    onProviderSwitch,
    onAttemptStart,
    startProvider = "primary",
    abortSignal,
  } = options;

  const attempts = MAX_FALLBACK_ATTEMPTS;
  const primaryModelMap = options.primaryModels ?? PRIMARY_MODELS;
  const fallbackModelMap = options.fallbackModels ?? FALLBACK_MODELS;
  // When startProvider is "fallback", flip which parity of attempt uses the
  // fallback endpoint so the very first attempt goes to fallback instead of
  // primary, while attempts still alternate afterwards.
  const fallbackParity = startProvider === "fallback" ? 0 : 1;

  // Chain of provider streams; each attempt appends its stream (or an error
  // part) to the output stream controller.
  const outputStream = new ReadableStream<TextStreamPart<any>>({
    async start(controller) {
      let attempt = 0;

      while (attempt < attempts) {
        const useFallback = clients.hasFallback && attempt % 2 === fallbackParity;
        const client = useFallback ? clients.fallback : clients.primary;
        const modelMap = useFallback ? fallbackModelMap : primaryModelMap;
        const resolvedModelId = modelMap[modelId] ?? modelMap.instant;
        let receivedText = false;
        let firstTextFired = false;
        if (onAttemptStart) onAttemptStart(attempt);

        try {
          const result = streamText({
            model: client.chat(resolvedModelId),
            system,
            messages,
            ...getStreamingModelOptions(modelSettings),
            ...(reasoning ? { reasoning } : {}),
            maxRetries,
            abortSignal,
            onChunk: onTextDelta
              ? async ({ chunk }) => {
                  if (chunk.type === "text-delta") {
                    chunk.text = onTextDelta(chunk.text);
                  }
                }
              : undefined,
          });

          const reader = result.stream.getReader();

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value.type === "error") {
              throw value.error;
            }
            if (value.type === "text-delta" && value.text.length > 0) {
              receivedText = true;
              if (onFirstText && !firstTextFired) {
                firstTextFired = true;
                onFirstText();
              }
            }
            controller.enqueue(value);
          }
          // Successfully finished this attempt — close the output stream.
          controller.close();
          return;
        } catch (error) {
          if (onAttemptError) onAttemptError(error, attempt);
          // A mid-stream failure after text has started cannot be retried
          // seamlessly — propagate it to the caller.
          if (receivedText) throw error;
          if (!clients.hasFallback) throw error;
          if (attempt < attempts - 1) {
            if (onProviderSwitch) {
              // Report the provider the next attempt will use.
              const nextAttempt = attempt + 1;
              const nextProvider =
                clients.hasFallback && nextAttempt % 2 === fallbackParity ? "fallback" : "primary";
              onProviderSwitch(nextProvider, attempt);
            }
            attempt++;
            continue;
          }
          throw error;
        }
      }
    },
  });

  return outputStream;
}

/**
 * Runs a sub-call (search query generation, file extraction, planner) with the
 * same alternating fallback chain. Returns the accumulated text, or "" when
 * every attempt failed.
 *
 * Reads the raw stream parts (not `textStream`, which silently swallows
 * provider errors) so a failed attempt is detected and retried on the other
 * endpoint.
 */
export async function runSubcallWithFallback(
  clients: ProviderClients,
  options: StreamWithFallbackOptions & { system?: string }
): Promise<string> {
  let lastError: unknown;
  const primaryModelMap = options.primaryModels ?? PRIMARY_MODELS;
  const fallbackModelMap = options.fallbackModels ?? FALLBACK_MODELS;
  const fallbackParity = options.startProvider === "fallback" ? 0 : 1;

  for (let attempt = 0; attempt < MAX_FALLBACK_ATTEMPTS; attempt++) {
    const useFallback = clients.hasFallback && attempt % 2 === fallbackParity;
    const client = useFallback ? clients.fallback : clients.primary;
    const modelMap = useFallback ? fallbackModelMap : primaryModelMap;
    const resolvedModelId = modelMap[options.modelId] ?? modelMap.instant;
    if (options.onAttemptStart) options.onAttemptStart(attempt);
    try {
      const result = streamText({
        model: client.chat(resolvedModelId),
        system: options.system,
        messages: options.messages,
        maxRetries: options.maxRetries ?? MODEL_MAX_RETRIES,
        ...(options.reasoning ? { reasoning: options.reasoning } : {}),
        abortSignal: options.abortSignal,
      });

      let text = "";
      let failed = false;
      const reader = result.stream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value.type === "error") {
          failed = true;
          lastError = value.error;
          break;
        }
        if (value.type === "text-delta") {
          const filtered = options.onTextDelta ? options.onTextDelta(value.text) : value.text;
          text += filtered;
        }
      }

      if (!failed) return text;
      if (options.onAttemptError && lastError !== undefined) {
        options.onAttemptError(lastError, attempt);
      }
    } catch (error) {
      lastError = error;
      if (options.onAttemptError) options.onAttemptError(error, attempt);
    }

    if (!clients.hasFallback) break;
  }

  if (lastError !== undefined && options.onAttemptError) {
    options.onAttemptError(lastError, MAX_FALLBACK_ATTEMPTS);
  }
  return "";
}
