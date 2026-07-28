import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

const CODES_FILE = path.join(process.cwd(), "data", "paid-codes.json");

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

export async function POST(req: Request) {
  try {
    const { code } = await req.json();

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    const codes = readCodes();
    const found = codes.find((c) => c.code === code);

    if (!found) {
      return NextResponse.json({ valid: false, error: "Invalid code" }, { status: 200 });
    }

    if (found.redeemed) {
      return NextResponse.json({ valid: false, error: "Code has already been redeemed" }, { status: 200 });
    }

    // Check expiry
    const expiresAt = new Date(found.expiresAt);
    if (expiresAt <= new Date()) {
      return NextResponse.json({ valid: false, error: "Code has expired" }, { status: 200 });
    }

    // Mark as redeemed
    found.redeemed = true;
    found.redeemedAt = new Date().toISOString();
    writeCodes(codes);

    return NextResponse.json({
      valid: true,
      data: {
        code: found.code,
        expiresAt: found.expiresAt,
        tokens: found.tokens,
      },
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
