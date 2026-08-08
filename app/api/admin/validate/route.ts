import { NextResponse } from "next/server";
import { getAdminKey } from "@/lib/admin-auth";

export async function POST(req: Request) {
  try {
    const { key } = await req.json();

    if (typeof key === "string" && key.trim() && key === getAdminKey()) {
      return NextResponse.json({ valid: true });
    }

    return NextResponse.json({ valid: false }, { status: 401 });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
