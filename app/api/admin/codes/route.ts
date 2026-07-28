import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const CODES_FILE = path.join(process.cwd(), "data", "paid-codes.json");
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

function readCodes(): PaidCode[] {
  try {
    const raw = fs.readFileSync(CODES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeCodes(codes: PaidCode[]) {
  fs.writeFileSync(CODES_FILE, JSON.stringify(codes, null, 2));
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
    const { code, expiresAt, tokens } = await req.json();
    
    if (!code || !expiresAt || !tokens) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
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
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code, expiresAt, tokens } = await req.json();
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
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { code } = await req.json();
    const codes = readCodes();
    const index = codes.findIndex((c) => c.code === code);

    if (index === -1) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    codes.splice(index, 1);
    writeCodes(codes);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
