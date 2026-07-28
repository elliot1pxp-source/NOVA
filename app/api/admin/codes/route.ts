import { NextResponse } from "next/server";
import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${ADMIN_KEY}`;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const codes = await readCodes();
  return NextResponse.json(
    { codes },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
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

    const codes = await readCodes();
    
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
    await writeCodes(codes);

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
    const { code, expiresAt, tokens, redeemed, redeemedBy, redeemedAt } = body;
    
    if (!code) {
      return NextResponse.json({ error: "Missing required field: code" }, { status: 400 });
    }

    const codes = await readCodes();
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
    if (redeemed !== undefined) codes[index].redeemed = Boolean(redeemed);
    if (redeemedBy !== undefined) codes[index].redeemedBy = redeemedBy;
    if (redeemedAt !== undefined) codes[index].redeemedAt = redeemedAt;

    await writeCodes(codes);
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
