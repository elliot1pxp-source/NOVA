import { NextResponse } from "next/server";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";

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
