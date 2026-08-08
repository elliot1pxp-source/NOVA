import { NextResponse } from "next/server";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export type GlobalSettings = {
  BLOCKRUN_API_KEY: string;
  SERPER_API_KEY: string;
};

const DEFAULT_SETTINGS: GlobalSettings = {
  BLOCKRUN_API_KEY: "",
  SERPER_API_KEY: "",
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
  return NextResponse.json(
    { settings },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function PUT(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { BLOCKRUN_API_KEY, SERPER_API_KEY } = body;
    
    const settings = await readSettings();

    if (BLOCKRUN_API_KEY !== undefined) settings.BLOCKRUN_API_KEY = BLOCKRUN_API_KEY;
    if (SERPER_API_KEY !== undefined) settings.SERPER_API_KEY = SERPER_API_KEY;

    await writeSettings(settings);
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("PUT /api/admin/global-settings error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
