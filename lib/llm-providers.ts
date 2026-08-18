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
  type ToolSet,
} from "ai";
import { createOpenAI } from "@ai-sdk/openai";

// Per-provider model mappings. The primary endpoint (BASED_URL) uses "oc/"
// prefixed model IDs; the fallback endpoint (FALLBACK_BASED_URL) uses 
// unprefixed IDs. Both expose the same logical models.

export const PRIMARY_MODELS: Record<string, string> = {
  instant: "nvidia/nemotron-3-super-120b-a12b:free",
  expert: "nvidia/nemotron-3-ultra-550b-a55b:free",
  websearch: "nvidia/nemotron-3-ultra-550b-a55b:free",
  fileAnalysis: "nvidia/nemotron-3.5-lightning:free",
  coding: "tencent/hy3:free",
};

export const FALLBACK_MODELS: Record<string, string> = {
  instant: "deepseek-v4-flash-free",
  expert: "big-pickle",
  websearch: "deepseek-v4-flash-free",
  fileAnalysis: "nemotron-3-ultra-free",
  coding: "deepseek-v4-flash-free",
};

// Model role keys used by call sites. The fallback functions resolve each key
// to the correct per-provider model ID (PRIMARY_MODELS vs FALLBACK_MODELS).
export const MODELS: Record<string, string> = {
  instant: "instant",
  expert: "expert",
  coding: "coding",
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
          choices?: Array<{ delta?: { reasoning_content?: string | null; reasoning?: string | null } }>;
        };
        // OpenRouter/kilo gateways may emit thinking in either field: DeepSeek-style
        // uses `reasoning_content`, while OpenAI/OpenRouter-style uses `reasoning`.
        const delta = parsed.choices?.[0]?.delta;
        const reasoningText = delta?.reasoning_content ?? delta?.reasoning;
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

// Module-level ref so the gateway-aware fetch can read the active reasoning level
let activeReasoningLevel: string | undefined;
let activeReasoningDelta: ((text: string) => void) | undefined;

function isOpenRouterCompatibleBaseURL(baseURL: string): boolean {
  const u = baseURL.toLowerCase();
  return u.includes("openrouter.ai") || u.includes("kilo.ai");
}

function normalizeEffort(level: string): "low" | "medium" | "high" | null {
  switch (level) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
      return "high";
    default:
      return null;
  }
}

/** Fetch wrapper that rewrites request body for OpenRouter-compatible gateways
 *  (injecting reasoning: { effort } and removing reasoning_effort) and
 *  optionally tees SSE events for reasoning_content deltas. */
function createOpenRouterAwareFetch(
  baseURL: string,
  innerFetch: typeof fetch
): typeof fetch {
  const isOpenRouter = isOpenRouterCompatibleBaseURL(baseURL);

  return async (input: string | Request | URL, init?: RequestInit): Promise<Response> => {
    // For OpenRouter-compatible endpoints, rewrite the request body
    if (isOpenRouter && init?.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        // Remove OpenAI-style reasoning_effort; inject OpenRouter-style reasoning object
        if (body.reasoning_effort !== undefined || body.reasoning !== undefined) {
          delete body.reasoning_effort;
          const effort = normalizeEffort(activeReasoningLevel ?? "");
          if (effort) {
            body.reasoning = { effort, exclude: false };
            // Ensure the gateway returns the thinking tokens in the stream.
            body.include_reasoning = true;
          } else {
            delete body.reasoning;
            delete body.include_reasoning;
          }
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch {
        // ignore parse errors
      }
    }

    const request = new Request(input, init);
    const response = await innerFetch(request.url, {
      ...init,
      body: request.body,
      method: request.method,
      signal: request.signal,
      duplex: "half",
    } as NodeFetchRequestInit as RequestInit);

    if (!activeReasoningDelta) return response;
    return teeSseEvents(response, activeReasoningDelta);
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
  activeReasoningDelta = onReasoningDelta;
  const primaryBaseURL =
    options?.primaryBaseURL ||
    getServerEnvValue(
      "BASED_URL",
      "BASE_URL",
      "BLOCKRUN_BASE_URL",
      "OPENAI_BASE_URL"
    ) || "https://api.openai.com/v1";
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
    primaryFetch = createOpenRouterAwareFetch(
      primaryBaseURL,
      createCustomFetch(customPrimaryHeaders, onReasoningDelta)
    ) as typeof fetch;
  } else if (!apiKey) {
    primaryFetch = createOpenRouterAwareFetch(
      primaryBaseURL,
      createCustomFetch({}, onReasoningDelta)
    ) as typeof fetch;
  } else if (onReasoningDelta) {
    // Real key, no custom auth template, but reasoning tee requested — wrap
    // without touching the SDK's Authorization header.
    primaryFetch = createOpenRouterAwareFetch(
      primaryBaseURL,
      fetch
    ) as typeof fetch;
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
    options?.fallbackBaseURL || getServerEnvValue("FALLBACK_BASED_URL") || "https://api.openai.com/v1";
  const fallbackApiKey =
    options?.fallbackApiKey || getServerEnvValue("FALLBACK_API_KEY");
  const hasFallback =
    Boolean(fallbackBaseURL && fallbackApiKey) && fallbackBaseURL !== primaryBaseURL;

  const fallback = hasFallback
    ? createOpenAI({
        baseURL: fallbackBaseURL,
        apiKey: fallbackApiKey ?? "fallback",
        ...(onReasoningDelta
          ? { fetch: createOpenRouterAwareFetch(fallbackBaseURL, fetch) as typeof fetch }
          : {}),
      })
    : primary;

  return { primary, fallback, hasFallback };
}

export type StreamingModelOptions = {
  temperature?: number;
  maxOutputTokens?: number;
};

// PRIMARY_MODELS / FALLBACK_MODELS point at two aggregator/proxy endpoints
// whose advertised max-output-tokens figures do not reliably match what the
// backend actually enforces (confirmed: a request above the real ceiling is
// rejected with a 400 rather than being clamped upstream). Every resolved
// model id currently in use here has been verified to top out at 131072 —
// list them explicitly for clarity, and fall back to that same conservative
// value for anything not listed rather than trusting an unverified
// advertised limit or an unbounded client-supplied maxTokens.
const DEFAULT_MAX_OUTPUT_TOKENS = 131_072;

const MODEL_MAX_OUTPUT_TOKENS: Record<string, number> = {
  "oc/deepseek-v4-flash-free": 131_072,
  "oc/big-pickle": 131_072,
  "deepseek-v4-flash-free": 131_072,
  "big-pickle": 131_072,
  "nemotron-3-ultra-free": 131_072,
};

/**
 * Clamps a requested max-output-tokens value to the known-safe ceiling for
 * the resolved model. Returns `undefined` unchanged when no value was
 * requested — this only guards against asking for MORE than a model
 * supports; it never invents a cap where the caller (or the provider's own
 * default) didn't ask for one.
 */
function clampMaxOutputTokens(
  resolvedModelId: string | undefined,
  requested: number | undefined
): number | undefined {
  if (requested === undefined) return undefined;
  const cap =
    (resolvedModelId !== undefined
      ? MODEL_MAX_OUTPUT_TOKENS[resolvedModelId]
      : undefined) ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (requested > cap) {
    console.warn(
      `[llm-providers] requested maxTokens ${requested} exceeds ${resolvedModelId ?? "model"}'s limit of ${cap} — clamping`
    );
    return cap;
  }
  return requested;
}

export function getStreamingModelOptions(
  modelSettings?: { temperature?: number; topK?: number; maxTokens?: number },
  resolvedModelId?: string
): StreamingModelOptions {
  const options: StreamingModelOptions = {};

  if (modelSettings?.temperature !== undefined) {
    options.temperature = modelSettings.temperature;
  }

  const clampedMaxTokens = clampMaxOutputTokens(resolvedModelId, modelSettings?.maxTokens);
  if (clampedMaxTokens !== undefined) {
    options.maxOutputTokens = clampedMaxTokens;
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
  /**
   * Tools exposed to the model for native tool calling. Executed server-side
   * by the AI SDK and fed back to the model; the resulting tool-call /
   * tool-result parts flow through the stream to the client.
   */
  tools?: ToolSet;
  /** Force (or forbid) a tool call. Defaults to the model's choice. */
  toolChoice?: "auto" | "required" | "none" | { type: "tool"; toolName: string };
  /**
   * Stop conditions for the tool-calling loop. Required when `tools` is set,
   * otherwise the SDK stops after a single generation step and never runs the
   * tool result. Accepts any condition the AI SDK's `streamText` supports.
   */
  stopWhen?: any;
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
    tools,
    toolChoice,
    stopWhen,
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
        console.info(
          `[llm] ${useFallback ? "fallback" : "primary"} endpoint -> model: ${resolvedModelId} (attempt ${attempt + 1})`
        );
        let receivedText = false;
        let firstTextFired = false;
        if (onAttemptStart) onAttemptStart(attempt);

        try {
          // Set active reasoning level so the gateway-aware fetch can inject
          // OpenRouter-compatible reasoning: { effort } instead of reasoning_effort
          activeReasoningLevel = reasoning;
          const result = streamText({
            model: client.chat(resolvedModelId),
            system,
            messages,
            ...getStreamingModelOptions(modelSettings, resolvedModelId),
            ...(reasoning ? { reasoning } : {}),
            ...(tools ? { tools } : {}),
            ...(toolChoice ? { toolChoice } : {}),
            ...(stopWhen ? { stopWhen } : {}),
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

          // The attempt ended but produced no text token at all (an empty
          // completion). Treat it as a failed attempt and retry on the other
          // endpoint (or the same one when there is no fallback) until we
          // actually receive some text — otherwise the client's typing
          // indicator just vanishes leaving a blank reply.
          if (!receivedText) {
            if (onAttemptError) onAttemptError(new Error("empty response (no text token)"), attempt);
            if (attempt < attempts - 1) {
              if (onProviderSwitch) {
                const nextAttempt = attempt + 1;
                const nextProvider =
                  clients.hasFallback && nextAttempt % 2 === fallbackParity ? "fallback" : "primary";
                onProviderSwitch(nextProvider, attempt);
              }
              attempt++;
              continue;
            }
            // Every attempt came back empty — nothing more we can do.
            controller.close();
            return;
          }

          // Successfully finished this attempt with text — close the stream.
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
    console.info(
      `[llm] ${useFallback ? "fallback" : "primary"} endpoint -> model: ${resolvedModelId} (attempt ${attempt + 1})`
    );
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
