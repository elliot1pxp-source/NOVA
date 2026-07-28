import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const CODES_FILE = path.join(DATA_DIR, "paid-codes.json");

type PaidCode = {
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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    const codes = readCodes();
    const found = codes.find((c) => c.code === code);

    if (!found) {
      return NextResponse.json({ valid: false, error: "Code not found" }, { status: 200 });
    }

    // Check if expired
    const expiresAt = new Date(found.expiresAt);
    if (expiresAt <= new Date()) {
      return NextResponse.json({ valid: false, expired: true, error: "Code has expired" }, { status: 200 });
    }

    return NextResponse.json({
      valid: true,
      data: {
        code: found.code,
        expiresAt: found.expiresAt,
        tokens: found.tokens,
      },
    });
  } catch (err) {
    console.error("POST /api/paid-tier/status error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
