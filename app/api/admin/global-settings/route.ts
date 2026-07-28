import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "global-settings.json");
const ADMIN_KEY = "FHUDSFIUSFHIUFE3248328&^&@^#&@#^*@^";

export type GlobalSettings = {
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  DEEPTHINK_TOKEN: string;
  SERPER_API_KEY: string;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readSettings(): GlobalSettings {
  try {
    ensureDataDir();
    if (!fs.existsSync(SETTINGS_FILE)) {
      const defaults = { GOOGLE_GENERATIVE_AI_API_KEY: "", DEEPTHINK_TOKEN: "", SERPER_API_KEY: "" };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2));
      return defaults;
    }
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("readSettings error:", err);
    return { GOOGLE_GENERATIVE_AI_API_KEY: "", DEEPTHINK_TOKEN: "", SERPER_API_KEY: "" };
  }
}

function writeSettings(settings: GlobalSettings) {
  try {
    ensureDataDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
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
  const settings = readSettings();
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { GOOGLE_GENERATIVE_AI_API_KEY, DEEPTHINK_TOKEN, SERPER_API_KEY } = body;
    
    const settings = readSettings();

    if (GOOGLE_GENERATIVE_AI_API_KEY !== undefined) settings.GOOGLE_GENERATIVE_AI_API_KEY = GOOGLE_GENERATIVE_AI_API_KEY;
    if (DEEPTHINK_TOKEN !== undefined) settings.DEEPTHINK_TOKEN = DEEPTHINK_TOKEN;
    if (SERPER_API_KEY !== undefined) settings.SERPER_API_KEY = SERPER_API_KEY;

    writeSettings(settings);
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    console.error("PUT /api/admin/global-settings error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
