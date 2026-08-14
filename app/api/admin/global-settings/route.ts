import { NextResponse } from "next/server";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { getEffectiveSystemPrompt, readSystemPromptFile } from "@/lib/system-prompt";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type ModelMap = Record<string, string>;

export type GlobalSettings = {
  BLOCKRUN_API_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY?: string;
  BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
  useFallbackAsPrimary?: boolean;
  PRIMARY_MODELS?: ModelMap;
  FALLBACK_MODELS?: ModelMap;
  /** When true, chat history is converted to a single string and injected into the system prompt instead of being sent as a messages array. Useful for web-cookie models that don't support message arrays. */
  stringBasedChatHistory?: boolean;
  /** When true, automatically detect web-cookie models (containing "web" in model name) and apply string-based chat history. */
  autoDetectWebCookieModels?: boolean;
  /** Live-editable system prompt. When set (non-empty) it overrides the bundled systemprompt.txt at runtime. */
  SYSTEM_PROMPT?: string;
};

export type GlobalSettingsHistoryEntry = {
  id: string;
  timestamp: string;
  label: string;
  changedBy: string;
  before: GlobalSettings;
  after: GlobalSettings;
  changes: Record<string, { before: any; after: any }>;
};

const DEFAULT_SETTINGS: GlobalSettings = {
  BLOCKRUN_API_KEY: "",
  FALLBACK_API_KEY: "",
  SERPER_API_KEY: "",
  BASED_URL: "",
  FALLBACK_BASED_URL: "",
  useFallbackAsPrimary: false,
  PRIMARY_MODELS: undefined,
  FALLBACK_MODELS: undefined,
  stringBasedChatHistory: false,
  autoDetectWebCookieModels: false,
  SYSTEM_PROMPT: "",
};

async function readSettings(): Promise<GlobalSettings> {
  try {
    return await readData<GlobalSettings>(STORAGE_KEYS.GLOBAL_SETTINGS, DEFAULT_SETTINGS);
  } catch (err) {
    console.error("readSettings error:", err);
    return { ...DEFAULT_SETTINGS };
  }
}

async function writeSettings(settings: GlobalSettings): Promise<void> {
  try {
    await writeData(STORAGE_KEYS.GLOBAL_SETTINGS, settings);
  } catch (err) {
    console.error("writeSettings error:", err);
    throw err;
  }
}

async function readSettingsHistory(): Promise<GlobalSettingsHistoryEntry[]> {
  try {
    return await readData<GlobalSettingsHistoryEntry[]>(STORAGE_KEYS.GLOBAL_SETTINGS_HISTORY, []);
  } catch (err) {
    console.error("readSettingsHistory error:", err);
    return [];
  }
}

async function writeSettingsHistory(history: GlobalSettingsHistoryEntry[]): Promise<void> {
  try {
    await writeData(STORAGE_KEYS.GLOBAL_SETTINGS_HISTORY, history);
  } catch (err) {
    console.error("writeSettingsHistory error:", err);
    throw err;
  }
}

function computeChanges(before: GlobalSettings, after: GlobalSettings) {
  const allKeys = new Set<string>([...Object.keys(before), ...Object.keys(after)]);
  const changes: Record<string, { before: any; after: any }> = {};

  allKeys.forEach((key) => {
    const beforeValue = (before as any)[key];
    const afterValue = (after as any)[key];
    const beforeJson = JSON.stringify(beforeValue ?? null);
    const afterJson = JSON.stringify(afterValue ?? null);
    if (beforeJson !== afterJson) {
      changes[key] = {
        before: beforeValue === undefined ? null : beforeValue,
        after: afterValue === undefined ? null : afterValue,
      };
    }
  });

  return changes;
}

async function appendSettingsHistory(entry: GlobalSettingsHistoryEntry): Promise<void> {
  const history = await readSettingsHistory();
  history.unshift(entry);
  await writeSettingsHistory(history);
}

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await readSettings();
  const env = {
    ADMIN_KEY: process.env.ADMIN_KEY ?? "",
    BLOCKRUN_API_KEY: process.env.BLOCKRUN_API_KEY ?? process.env.BLOCKRUN_TOKEN ?? process.env.OPENAI_API_KEY ?? "",
    FALLBACK_API_KEY: process.env.FALLBACK_API_KEY ?? "",
    SERPER_API_KEY: process.env.SERPER_API_KEY ?? "",
    BASED_URL: process.env.BASED_URL ?? process.env.BASE_URL ?? process.env.BLOCKRUN_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "",
    FALLBACK_BASED_URL: process.env.FALLBACK_BASED_URL ?? "",
  };

  // The prompt that will actually be used at runtime: the configured
  // SYSTEM_PROMPT if set, otherwise the bundled systemprompt.txt. Surfaced
  // so the admin editor can prefill and show what is currently active.
  const effectiveSystemPrompt = await getEffectiveSystemPrompt();
  const usingFileFallback = !settings.SYSTEM_PROMPT || settings.SYSTEM_PROMPT.trim().length === 0;
  const fileSystemPrompt = readSystemPromptFile();

  return NextResponse.json(
    { settings, env, effectiveSystemPrompt, usingFileFallback, fileSystemPrompt },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function PUT(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      BLOCKRUN_API_KEY,
      FALLBACK_API_KEY,
      SERPER_API_KEY,
      BASED_URL,
      FALLBACK_BASED_URL,
      useFallbackAsPrimary,
      PRIMARY_MODELS,
      FALLBACK_MODELS,
      stringBasedChatHistory,
      autoDetectWebCookieModels,
      SYSTEM_PROMPT,
    } = body;
    
    const settings = await readSettings();
    const previousSettings: GlobalSettings = {
      ...settings,
      PRIMARY_MODELS: settings.PRIMARY_MODELS ? { ...settings.PRIMARY_MODELS } : undefined,
      FALLBACK_MODELS: settings.FALLBACK_MODELS ? { ...settings.FALLBACK_MODELS } : undefined,
    };

    if (BLOCKRUN_API_KEY !== undefined) settings.BLOCKRUN_API_KEY = BLOCKRUN_API_KEY;
    if (FALLBACK_API_KEY !== undefined) settings.FALLBACK_API_KEY = FALLBACK_API_KEY;
    if (SERPER_API_KEY !== undefined) settings.SERPER_API_KEY = SERPER_API_KEY;
    if (BASED_URL !== undefined) settings.BASED_URL = BASED_URL;
    if (FALLBACK_BASED_URL !== undefined) settings.FALLBACK_BASED_URL = FALLBACK_BASED_URL;
    if (useFallbackAsPrimary !== undefined) settings.useFallbackAsPrimary = Boolean(useFallbackAsPrimary);
    if (PRIMARY_MODELS !== undefined) settings.PRIMARY_MODELS = PRIMARY_MODELS;
    if (FALLBACK_MODELS !== undefined) settings.FALLBACK_MODELS = FALLBACK_MODELS;
    if (stringBasedChatHistory !== undefined) settings.stringBasedChatHistory = Boolean(stringBasedChatHistory);
    if (autoDetectWebCookieModels !== undefined) settings.autoDetectWebCookieModels = Boolean(autoDetectWebCookieModels);
    if (SYSTEM_PROMPT !== undefined) settings.SYSTEM_PROMPT = SYSTEM_PROMPT;

    const label = typeof body.label === "string" && body.label.trim().length > 0
      ? body.label.trim()
      : "Updated global settings";
    const authHeader = req.headers.get("authorization") ?? "";
    const changedBy = authHeader.startsWith("Bearer ")
      ? `admin-${authHeader.slice(7, 11)}...`
      : "admin";

    await writeSettings(settings);
    const changes = computeChanges(previousSettings, settings);
    if (Object.keys(changes).length > 0) {
      await appendSettingsHistory({
        id: crypto.randomUUID?.() ?? `${Date.now()}`,
        timestamp: new Date().toISOString(),
        label,
        changedBy,
        before: previousSettings,
        after: settings,
        changes,
      });
    }

    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("PUT /api/admin/global-settings error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
