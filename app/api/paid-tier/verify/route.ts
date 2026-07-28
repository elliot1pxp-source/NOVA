import { NextResponse } from "next/server";
import { getMaxRedemptions, getRedemptionCount, getRedeemedUserIds, hasRedeemedCode, isCodeExpired, PaidCode } from "@/lib/paid-codes";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";

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
    const { code, clientId } = body;

    if (!code || typeof code !== "string" || !clientId || typeof clientId !== "string") {
      return NextResponse.json({ error: "Code and client ID are required" }, { status: 400 });
    }

    const codes = await readCodes();
    const found = codes.find((c) => c.code === code);

    if (!found) {
      return NextResponse.json({ valid: false, error: "Invalid code" }, { status: 200 });
    }

    // Check expiry
    if (isCodeExpired(found)) {
      return NextResponse.json({ valid: false, error: "Code has expired" }, { status: 200 });
    }

    const redeemedUserIds = getRedeemedUserIds(found);
    if (hasRedeemedCode(found, clientId)) {
      if (redeemedUserIds.length === 0) {
        return NextResponse.json({ valid: false, error: "Code has already been redeemed" }, { status: 200 });
      }

      return NextResponse.json({
        valid: true,
        data: {
          code: found.code,
          expiresAt: found.expiresAt,
          tokens: found.tokens,
        },
      });
    }

    if (getRedemptionCount(found) >= getMaxRedemptions(found)) {
      return NextResponse.json({ valid: false, error: "Code has reached its redemption limit" }, { status: 200 });
    }

    const now = new Date();
    if (!found.activatedAt && found.durationMinutes) {
      found.activatedAt = now.toISOString();
      found.expiresAt = new Date(now.getTime() + found.durationMinutes * 60_000).toISOString();
    }

    // Add this user without restarting the shared activation timer.
    found.redeemedUserIds = [...redeemedUserIds, clientId];
    found.redemptionCount = found.redeemedUserIds.length;
    found.redeemed = true;
    found.redeemedAt = found.activatedAt || now.toISOString();
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
