import { NextResponse } from "next/server";
import { hasRedeemedCode, isCodeExpired, PaidCode } from "@/lib/paid-codes";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";

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
    const { code, clientId } = body;

    if (!code || typeof code !== "string" || !clientId || typeof clientId !== "string") {
      return NextResponse.json({ error: "Code and client ID are required" }, { status: 400 });
    }

    const codes = await readCodes();
    const found = codes.find((c) => c.code === code);

    if (!found) {
      return NextResponse.json({ valid: false, error: "Code not found" }, { status: 200 });
    }

    // A reset removes the user's redemption record, revoking the prior session.
    if (!hasRedeemedCode(found, clientId)) {
      return NextResponse.json({
        valid: false,
        expired: true,
        error: "Paid access has been reset. Please redeem the code again.",
      }, { status: 200 });
    }

    // Check if expired
    if (isCodeExpired(found)) {
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
