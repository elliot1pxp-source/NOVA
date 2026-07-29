import { NextResponse } from "next/server";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ADMIN_KEY = "FHUDSFIUSFHIUFE3248328&^&@^#&@#^*@^";

export type GlobalSettings = {
  POLLINATIONS_API_KEY: string;
  DEEPTHINK_TOKEN: string;
  SERPER_API_KEY: string;
};

const DEFAULT_SETTINGS: GlobalSettings = {
  POLLINATIONS_API_KEY: "",
  DEEPTHINK_TOKEN: "",
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

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${ADMIN_KEY}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = await readSettings();
  return NextResponse.json(
    { settings },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

export async function PUT(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { POLLINATIONS_API_KEY, DEEPTHINK_TOKEN, SERPER_API_KEY } = body;
    
    const settings = await readSettings();

    if (POLLINATIONS_API_KEY !== undefined) settings.POLLINATIONS_API_KEY = POLLINATIONS_API_KEY;
    if (DEEPTHINK_TOKEN !== undefined) settings.DEEPTHINK_TOKEN = DEEPTHINK_TOKEN;
    if (SERPER_API_KEY !== undefined) settings.SERPER_API_KEY = SERPER_API_KEY;

    await writeSettings(settings);
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("PUT /api/admin/global-settings error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
