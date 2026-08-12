// Server-side history backup logic, injected with a storage adapter so it can
// run against Vercel KV (via lib/server-storage), the dev in-memory store, or
// a plain in-memory Map in tests. The route handler (app/api/history/route.ts)
// is a thin Next.js wrapper around these functions.

import {
  type HistoryMeta,
  isValidClientId,
  sanitizeChats,
  sanitizeMessages,
} from "@/lib/history-utils";

export type HistoryStore = {
  read<T>(key: string, defaultValue: T): Promise<T>;
  write<T>(key: string, value: T): Promise<void>;
};

export const META_PREFIX = "nova:history:meta:";
export const CHAT_PREFIX = "nova:history:chat:";

const MAX_CHAT_ID_LENGTH = 200;

function metaKey(clientId: string) {
  return `${META_PREFIX}${clientId}`;
}

function chatKey(clientId: string, chatId: string) {
  return `${CHAT_PREFIX}${clientId}:${chatId}`;
}

export function isValidBackupClientId(clientId: unknown): clientId is string {
  return typeof clientId === "string" && isValidClientId(clientId);
}

export async function saveHistory(
  store: HistoryStore,
  input: {
    clientId: string;
    chats?: unknown;
    messages?: Record<string, unknown[]>;
    lastChatId?: string | null;
  }
): Promise<boolean> {
  const { clientId, chats, messages, lastChatId } = input;
  if (!isValidBackupClientId(clientId)) return false;

  const now = new Date().toISOString();
  const cleanChats = sanitizeChats(chats);

  if (cleanChats.length > 0 || typeof lastChatId === "string") {
    const meta: HistoryMeta = {
      chats: cleanChats,
      lastChatId: typeof lastChatId === "string" ? lastChatId : undefined,
      updatedAt: now,
    };
    await store.write(metaKey(clientId), meta);
  }

  if (messages && typeof messages === "object") {
    for (const chatId of Object.keys(messages)) {
      if (!chatId || chatId.length > MAX_CHAT_ID_LENGTH) continue;
      const clean = sanitizeMessages(messages[chatId]);
      if (clean.length === 0) continue;
      await store.write(chatKey(clientId, chatId), { messages: clean, updatedAt: now });
    }
  }

  return true;
}

export async function loadHistory(
  store: HistoryStore,
  clientId: string
): Promise<{ chats: HistoryMeta["chats"]; lastChatId: string | null; messages: Record<string, unknown[]> }> {
  if (!isValidBackupClientId(clientId)) {
    throw new Error("Invalid client id");
  }

  let meta: HistoryMeta | null = null;
  try {
    meta = await store.read<HistoryMeta | null>(metaKey(clientId), null);
  } catch {
    meta = null;
  }

  if (!meta || !Array.isArray(meta.chats) || meta.chats.length === 0) {
    return { chats: [], lastChatId: null, messages: {} };
  }

  const messages: Record<string, unknown[]> = {};
  for (const chat of meta.chats) {
    try {
      const stored = await store.read<{ messages?: unknown[] } | null>(chatKey(clientId, chat.id), null);
      if (stored && Array.isArray(stored.messages) && stored.messages.length > 0) {
        messages[chat.id] = stored.messages;
      }
    } catch {
      // skip a chat whose messages failed to read
    }
  }

  return {
    chats: meta.chats,
    lastChatId: meta.lastChatId ?? null,
    messages,
  };
}

export async function clearHistory(
  store: HistoryStore,
  clientId: string,
  chatId?: string
): Promise<boolean> {
  if (!isValidBackupClientId(clientId)) return false;

  const now = new Date().toISOString();

  if (typeof chatId === "string" && chatId) {
    let meta: HistoryMeta | null = null;
    try {
      meta = await store.read<HistoryMeta | null>(metaKey(clientId), null);
    } catch {
      meta = null;
    }
    if (meta && Array.isArray(meta.chats)) {
      await store.write(metaKey(clientId), {
        ...meta,
        chats: meta.chats.filter((c) => c.id !== chatId),
        updatedAt: now,
      });
    }
    return true;
  }

  await store.write(metaKey(clientId), {
    chats: [],
    lastChatId: null,
    updatedAt: now,
  });
  return true;
}
