import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const SETTINGS_FILE = path.join(process.cwd(), "data", "global-settings.json");
const ADMIN_KEY = "FHUDSFIUSFHIUFE3248328&^&@^#&@#^*@^";

export type GlobalSettings = {
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  DEEPTHINK_TOKEN: string;
  SERPER_API_KEY: string;
};

function readSettings(): GlobalSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { GOOGLE_GENERATIVE_AI_API_KEY: "", DEEPTHINK_TOKEN: "", SERPER_API_KEY: "" };
  }
}

function writeSettings(settings: GlobalSettings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
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
    const { GOOGLE_GENERATIVE_AI_API_KEY, DEEPTHINK_TOKEN, SERPER_API_KEY } = await req.json();
    const settings = readSettings();

    if (GOOGLE_GENERATIVE_AI_API_KEY !== undefined) settings.GOOGLE_GENERATIVE_AI_API_KEY = GOOGLE_GENERATIVE_AI_API_KEY;
    if (DEEPTHINK_TOKEN !== undefined) settings.DEEPTHINK_TOKEN = DEEPTHINK_TOKEN;
    if (SERPER_API_KEY !== undefined) settings.SERPER_API_KEY = SERPER_API_KEY;

    writeSettings(settings);
    return NextResponse.json({ success: true, settings });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
