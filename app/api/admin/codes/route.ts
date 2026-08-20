import { NextResponse } from "next/server";
import { getRedemptionCount, PaidCode } from "@/lib/paid-codes";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";
import { isAdminAuthorized } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function readCodes(): Promise<PaidCode[]> {
  return readData<PaidCode[]>(STORAGE_KEYS.PAID_CODES, []);
}

async function writeCodes(codes: PaidCode[]): Promise<void> {
  try {
    await writeData(STORAGE_KEYS.PAID_CODES, codes);
  } catch (err) {
    console.error("writeCodes error:", err);
    throw err;
  }
}

export async function GET(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const codes = await readCodes();
    return NextResponse.json(
      { codes },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    console.error("GET /api/admin/codes error:", err);
    return NextResponse.json({ error: "Unable to load codes from persistent storage" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  
  try {
    const body = await req.json();
    const { code, durationMinutes, maxRedemptions, tokens } = body;
    
    const duration = Number(durationMinutes);
    const maxUses = Number(maxRedemptions);

    if (!code || !tokens || !Number.isInteger(duration) || duration <= 0 || !Number.isInteger(maxUses) || maxUses <= 0) {
      return NextResponse.json({ error: "Code, duration, maximum redemptions, and tokens are required" }, { status: 400 });
    }

    const codes = await readCodes();
    
    // Check if code already exists
    if (codes.find((c) => c.code === code)) {
      return NextResponse.json({ error: "Code already exists" }, { status: 409 });
    }

    const newCode: PaidCode = {
      code,
      durationMinutes: duration,
      maxRedemptions: maxUses,
      redemptionCount: 0,
      redeemedUserIds: [],
      activatedAt: null,
      expiresAt: null,
      tokens: {
        MAIN_BASED_URL_KEY: tokens.MAIN_BASED_URL_KEY || "",
        FALLBACK_API_KEY: tokens.FALLBACK_API_KEY || "",
        SERPER_API_KEY: tokens.SERPER_API_KEY || "",
        MAIN_BASED_URL: tokens.MAIN_BASED_URL || "",
        FALLBACK_BASED_URL: tokens.FALLBACK_BASED_URL || "",
      },
      redeemed: false,
    };

    codes.push(newCode);
    await writeCodes(codes);

    return NextResponse.json({ success: true, code: newCode });
  } catch (err) {
    console.error("POST /api/admin/codes error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}

export async function PUT(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      code,
      expiresAt,
      tokens,
      durationMinutes,
      maxRedemptions,
      redeemed,
      redeemedBy,
      redeemedAt,
      redeemedUserIds,
      redemptionCount,
      activatedAt,
    } = body;
    
    if (!code) {
      return NextResponse.json({ error: "Missing required field: code" }, { status: 400 });
    }

    const codes = await readCodes();
    const index = codes.findIndex((c) => c.code === code);

    if (index === -1) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    if (expiresAt !== undefined) codes[index].expiresAt = expiresAt;
    if (durationMinutes !== undefined) {
      const duration = Number(durationMinutes);
      if (!Number.isInteger(duration) || duration <= 0) {
        return NextResponse.json({ error: "Duration must be a positive whole number of minutes" }, { status: 400 });
      }
      codes[index].durationMinutes = duration;
    }
    if (maxRedemptions !== undefined) {
      const maxUses = Number(maxRedemptions);
      if (!Number.isInteger(maxUses) || maxUses <= 0) {
        return NextResponse.json({ error: "Maximum redemptions must be a positive whole number" }, { status: 400 });
      }
      if (maxUses < getRedemptionCount(codes[index])) {
        return NextResponse.json({ error: "Maximum redemptions cannot be lower than the current redemption count" }, { status: 400 });
      }
      codes[index].maxRedemptions = maxUses;
    }
    if (tokens) {
      if (tokens.MAIN_BASED_URL_KEY !== undefined) codes[index].tokens.MAIN_BASED_URL_KEY = tokens.MAIN_BASED_URL_KEY;
      if (tokens.FALLBACK_API_KEY !== undefined) codes[index].tokens.FALLBACK_API_KEY = tokens.FALLBACK_API_KEY;
      if (tokens.SERPER_API_KEY !== undefined) codes[index].tokens.SERPER_API_KEY = tokens.SERPER_API_KEY;
      if (tokens.MAIN_BASED_URL !== undefined) codes[index].tokens.MAIN_BASED_URL = tokens.MAIN_BASED_URL;
      if (tokens.FALLBACK_BASED_URL !== undefined) codes[index].tokens.FALLBACK_BASED_URL = tokens.FALLBACK_BASED_URL;
    }
    if (redeemedUserIds !== undefined) codes[index].redeemedUserIds = redeemedUserIds;
    if (redemptionCount !== undefined) codes[index].redemptionCount = Number(redemptionCount);
    if (activatedAt !== undefined) codes[index].activatedAt = activatedAt;
    if (redeemed !== undefined) codes[index].redeemed = Boolean(redeemed);
    if (redeemedBy !== undefined) codes[index].redeemedBy = redeemedBy;
    if (redeemedAt !== undefined) codes[index].redeemedAt = redeemedAt;

    if (redeemed === false) {
      codes[index].redemptionCount = 0;
      codes[index].redeemedUserIds = [];
      codes[index].activatedAt = null;
      codes[index].redeemedBy = null;
      codes[index].redeemedAt = null;
      if (codes[index].durationMinutes) codes[index].expiresAt = null;
    }
    codes[index].redeemed = getRedemptionCount(codes[index]) > 0;

    await writeCodes(codes);
    return NextResponse.json({ success: true, code: codes[index] });
  } catch (err) {
    console.error("PUT /api/admin/codes error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  if (!isAdminAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { code } = body;
    
    if (!code) {
      return NextResponse.json({ error: "Missing required field: code" }, { status: 400 });
    }

    const codes = await readCodes();
    const index = codes.findIndex((c) => c.code === code);

    if (index === -1) {
      return NextResponse.json({ error: "Code not found" }, { status: 404 });
    }

    codes.splice(index, 1);
    await writeCodes(codes);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/admin/codes error:", err);
    return NextResponse.json({ error: `Invalid request: ${err instanceof Error ? err.message : "Unknown error"}` }, { status: 400 });
  }
}
