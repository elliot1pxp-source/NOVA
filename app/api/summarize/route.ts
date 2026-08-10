import { convertToModelMessages, UIMessage } from "ai";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";
import { hasRedeemedCode, PaidCode } from "@/lib/paid-codes";
import {
  createProviderClients,
  getServerEnvValue,
  MODELS,
  runSubcallWithFallback,
} from "@/lib/llm-providers";

export const maxDuration = 60;

// The provider can report transient "capacity busy" errors; retry internally
// so a summarization call does not fail on the first hiccup.
const MODEL_MAX_RETRIES = 3;

type GlobalSettings = {
  BLOCKRUN_API_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY?: string;
  BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
  useFallbackAsPrimary?: boolean;
  PRIMARY_MODELS?: Record<string, string>;
  FALLBACK_MODELS?: Record<string, string>;
};

async function readGlobalSettings(): Promise<GlobalSettings> {
  try {
    return await readData<GlobalSettings>(STORAGE_KEYS.GLOBAL_SETTINGS, {});
  } catch {
    return {};
  }
}

async function readPaidCodeByRedeemedCode(code: string, clientId: string): Promise<PaidCode | null> {
  try {
    const codes = await readData<PaidCode[]>(STORAGE_KEYS.PAID_CODES, []);
    return codes.find((c) => c.code === code && hasRedeemedCode(c, clientId)) || null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const {
    messages,
    model: modelKey = "instant",
    paidTierCode,
    paidTierClientId,
  }: {
    messages: UIMessage[];
    model?: string;
    paidTierCode?: string;
    paidTierClientId?: string | null;
  } = await req.json();

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Messages are required." }, { status: 400 });
  }

  // Resolve the API key and endpoint mapping the same way the chat route does:
  // 1. Redeemed paid tier code tokens -> 2. Global settings -> 3. Environment.
  let apiKey = getServerEnvValue("BLOCKRUN_API_KEY", "BLOCKRUN_TOKEN", "OPENAI_API_KEY");
  let fallbackApiKey = getServerEnvValue("FALLBACK_API_KEY");
  let primaryBaseURL = getServerEnvValue("BASED_URL", "BASE_URL", "BLOCKRUN_BASE_URL", "OPENAI_BASE_URL");
  let fallbackBaseURL = getServerEnvValue("FALLBACK_BASED_URL");
  let useFallbackAsPrimary = false;
  let runtimePrimaryModels: Record<string, string> | undefined;
  let runtimeFallbackModels: Record<string, string> | undefined;

  const paidCode =
    paidTierCode && paidTierClientId
      ? await readPaidCodeByRedeemedCode(paidTierCode, paidTierClientId)
      : null;
  if (paidCode?.expiresAt && new Date(paidCode.expiresAt) > new Date()) {
    if (paidCode.tokens.BLOCKRUN_API_KEY) apiKey = paidCode.tokens.BLOCKRUN_API_KEY;
    if (paidCode.tokens.FALLBACK_API_KEY) fallbackApiKey = paidCode.tokens.FALLBACK_API_KEY;
  } else {
    const globalSettings = await readGlobalSettings();
    if (globalSettings.BLOCKRUN_API_KEY) apiKey = globalSettings.BLOCKRUN_API_KEY;
    if (globalSettings.FALLBACK_API_KEY) fallbackApiKey = globalSettings.FALLBACK_API_KEY;
    if (globalSettings.BASED_URL) primaryBaseURL = globalSettings.BASED_URL;
    if (globalSettings.FALLBACK_BASED_URL) fallbackBaseURL = globalSettings.FALLBACK_BASED_URL;
    useFallbackAsPrimary = Boolean(globalSettings.useFallbackAsPrimary);
    runtimePrimaryModels = globalSettings.PRIMARY_MODELS;
    runtimeFallbackModels = globalSettings.FALLBACK_MODELS;
  }

  if (useFallbackAsPrimary) {
    [primaryBaseURL, fallbackBaseURL] = [fallbackBaseURL, primaryBaseURL];
    [apiKey, fallbackApiKey] = [fallbackApiKey, apiKey];
    [runtimePrimaryModels, runtimeFallbackModels] = [runtimeFallbackModels, runtimePrimaryModels];
  }

  // Primary + fallback endpoint clients with silent fail-over between them.
  const providerClients = createProviderClients(apiKey, {
    primaryBaseURL,
    fallbackBaseURL,
    fallbackApiKey,
  });

  // This provider always returns SSE streaming, even without stream: true,
  // so the text stream is consumed directly. Fails over silently:
  // default -> fallback -> default -> fallback.
  // Summarization is a background utility call — never reason.
  const summary = await runSubcallWithFallback(providerClients, {
    modelId: MODELS[modelKey] ?? MODELS.instant,
    system: "You maintain long-running conversation memory for NOVA. Summarize the supplied conversation so it can replace older messages as private context. Preserve the user's goals, relevant background, decisions, constraints, unresolved questions, and important facts. Do not address the user, add new information, or mention that a summary was made. Be concise but specific.",
    messages: await convertToModelMessages(messages),
    maxRetries: MODEL_MAX_RETRIES,
    reasoning: "none",
    primaryModels: runtimePrimaryModels,
    fallbackModels: runtimeFallbackModels,
    onAttemptError: (error, attempt) => {
      console.error(`[summarize] provider attempt ${attempt + 1} failed`, error);
    },
  });

  return Response.json({ summary: summary.trim() });
}
