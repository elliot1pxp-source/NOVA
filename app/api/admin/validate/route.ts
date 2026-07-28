import { NextResponse } from "next/server";

const ADMIN_KEY = "FHUDSFIUSFHIUFE3248328&^&@^#&@#^*@^";

export async function POST(req: Request) {
  try {
    const { key } = await req.json();
    
    if (key === ADMIN_KEY) {
      return NextResponse.json({ valid: true });
    }
    
    return NextResponse.json({ valid: false }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
