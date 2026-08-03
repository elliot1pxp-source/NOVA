import { NextResponse } from "next/server";
import { getFreeTierStatus } from "@/lib/free-tier";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId") || "";
  const chatId = searchParams.get("chatId") || "";

  if (!clientId) {
    return NextResponse.json({ error: "clientId is required" }, { status: 400 });
  }

  if (!chatId) {
    return NextResponse.json({ error: "chatId is required" }, { status: 400 });
  }

  try {
    const status = await getFreeTierStatus(clientId, chatId);
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to retrieve free tier status" },
      { status: 500 }
    );
  }
}
