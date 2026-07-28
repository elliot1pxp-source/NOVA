import { NextResponse } from "next/server";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";

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

async function readCodes(): Promise<PaidCode[]> {
  try {
    return await readData<PaidCode[]>(STORAGE_KEYS.PAID_CODES, []);
  } catch (err) {
    console.error("readCodes error:", err);
    return [];
  }
}

async function writeCodes(codes: PaidCode[]): Promise<void> {
  try {
    await writeData(STORAGE_KEYS.PAID_CODES, codes);
  } catch (err) {
    console.error("writeCodes error:", err);
    throw err;
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { code } = body;

    if (!code || typeof code !== "string") {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    const codes = await readCodes();
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
    await writeCodes(codes);

    return NextResponse.json({
      valid: true,
      data: {
        code: found.code,
        expiresAt: found.expiresAt,
        tokens: found.tokens,
      },
    });
  } catch (err) {
    console.error("POST /api/paid-tier/verify error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
