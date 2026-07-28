import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const CODES_FILE = path.join(DATA_DIR, "paid-codes.json");
const ADMIN_KEY = "FHUDSFIUSFHIUFE3248328&^&@^#&@#^*@^";

export type PaidCode = {
  code: string;
  expiresAt: string;
  tokens: {
    GOOGLE_GENERATIVE_AI_API_KEY: string;
    DEEPTHINK_TOKEN: string;
    SERPER_API_KEY: string;
  };
  redeemed: boolean;
  redeemedBy?: string | null;
  redeemedAt?: string | null;
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readCodes(): PaidCode[] {
  try {
    ensureDataDir();
    if (!fs.existsSync(CODES_FILE)) {
      fs.writeFileSync(CODES_FILE, "[]");
      return [];
    }
    const raw = fs.readFileSync(CODES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("readCodes error:", err);
    return [];
  }
}

function writeCodes(codes: PaidCode[]) {
  try {
    ensureDataDir();
    fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
  } catch (err) {
    console.error("writeCodes error:", err);
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
  const codes = readCodes();
  return NextResponse.json({ codes });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const body = await req.json();
    const { code, expiresAt, tokens } = body;
    
    if (!code || !expiresAt || !tokens) {
      return NextResponse.json({ error: "Missing required fields: code, expiresAt, tokens" }, { status: 400 });
    }

    const codes = readCodes();
    
    // Check if code already exists
    if (codes.find((c) => c.code === code)) {
      return NextResponse.json({ error: "Code already exists" }, { status: 409 });
    }

    const newCode: PaidCode = {
      code,
      expiresAt,
      tokens: {
        GOOGLE_GENERATIVE_AI_API_KEY: tokens.GOOGLE_GENERATIVE_AI_API_KEY || "",
        DEEPTHINK_TOKEN: tokens.DEEPTHINK_TOKEN || "",
        SERPER_API_KEY: tokens.SERPER_API_KEY || "",
      },
      redeemed: false,
    };

    codes.push(newCode);
    writeCodes(codes);

    return NextResponse.json({ success: true, code: newCode });
  } catch (err) {
    console.error("POST /api/admin/codes error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { code, expiresAt, tokens } = body;
    
    if (!code) {
      return NextResponse.json({ error: "Missing required field: code" }, { status: 400 });
    }

    const codes = readCodes();
    const index = codes.findIndex((c) => c.code === code);

    if (index === -1) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    if (expiresAt) codes[index].expiresAt = expiresAt;
    if (tokens) {
      if (tokens.GOOGLE_GENERATIVE_AI_API_KEY !== undefined) codes[index].tokens.GOOGLE_GENERATIVE_AI_API_KEY = tokens.GOOGLE_GENERATIVE_AI_API_KEY;
      if (tokens.DEEPTHINK_TOKEN !== undefined) codes[index].tokens.DEEPTHINK_TOKEN = tokens.DEEPTHINK_TOKEN;
      if (tokens.SERPER_API_KEY !== undefined) codes[index].tokens.SERPER_API_KEY = tokens.SERPER_API_KEY;
    }

    writeCodes(codes);
    return NextResponse.json({ success: true, code: codes[index] });
  } catch (err) {
    console.error("PUT /api/admin/codes error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { code } = body;
    
    if (!code) {
      return NextResponse.json({ error: "Missing required field: code" }, { status: 400 });
    }

    const codes = readCodes();
    const index = codes.findIndex((c) => c.code === code);

    if (index === -1) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    codes.splice(index, 1);
    writeCodes(codes);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/admin/codes error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
