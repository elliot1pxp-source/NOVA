import { NextResponse } from "next/server";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";
import { isAdminAuthorized } from "@/lib/admin-auth";

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

  return NextResponse.json(
    { settings, env },
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
    } = body;
    
    const settings = await readSettings();

    if (BLOCKRUN_API_KEY !== undefined) settings.BLOCKRUN_API_KEY = BLOCKRUN_API_KEY;
    if (FALLBACK_API_KEY !== undefined) settings.FALLBACK_API_KEY = FALLBACK_API_KEY;
    if (SERPER_API_KEY !== undefined) settings.SERPER_API_KEY = SERPER_API_KEY;
    if (BASED_URL !== undefined) settings.BASED_URL = BASED_URL;
    if (FALLBACK_BASED_URL !== undefined) settings.FALLBACK_BASED_URL = FALLBACK_BASED_URL;
    if (useFallbackAsPrimary !== undefined) settings.useFallbackAsPrimary = Boolean(useFallbackAsPrimary);
    if (PRIMARY_MODELS !== undefined) settings.PRIMARY_MODELS = PRIMARY_MODELS;
    if (FALLBACK_MODELS !== undefined) settings.FALLBACK_MODELS = FALLBACK_MODELS;

    await writeSettings(settings);
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("PUT /api/admin/global-settings error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
