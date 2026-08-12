import { NextResponse } from "next/server";
import { readData, writeData } from "@/lib/server-storage";
import {
  clearHistory,
  loadHistory,
  saveHistory,
  type HistoryStore,
} from "@/lib/history-store";

export const dynamic = "force-dynamic";

export const maxDuration = 20;

// Thin Next.js wrapper around the store-injected backup logic in
// lib/history-store.ts. Storage layout (Vercel KV / in-memory dev store):
//   nova:history:meta:<clientId>              -> { chats, lastChatId, updatedAt }
//   nova:history:chat:<clientId>:<chatId>     -> { messages, updatedAt }

const store: HistoryStore = {
  read: (key, defaultValue) => readData(key, defaultValue),
  write: (key, value) => writeData(key, value),
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { clientId, chats, messages, lastChatId } = body as {
      clientId?: string;
      chats?: unknown;
      messages?: Record<string, unknown[]>;
      lastChatId?: string | null;
    };

    if (typeof clientId !== "string" || !(await saveHistory(store, { clientId, chats, messages, lastChatId }))) {
      return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/history error:", err);
    return NextResponse.json({ error: "Unable to save history" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const clientId = searchParams.get("clientId") || "";

    if (typeof clientId !== "string") {
      return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
    }

    const data = await loadHistory(store, clientId);
    return NextResponse.json(data);
  } catch (err) {
    console.error("GET /api/history error:", err);
    if (err instanceof Error && err.message === "Invalid client id") {
      return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
    }
    return NextResponse.json({ error: "Unable to load history" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    const { clientId, chatId } = body as { clientId?: string; chatId?: string };

    if (typeof clientId !== "string" || !(await clearHistory(store, clientId, chatId))) {
      return NextResponse.json({ error: "Invalid client id" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/history error:", err);
    return NextResponse.json({ error: "Unable to clear history" }, { status: 500 });
  }
}
