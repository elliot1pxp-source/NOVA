"use client";

import {
  getClientId,
  importAllHistory,
  loadChats,
  loadLastChatId,
  saveLastChatId,
} from "@/lib/storage";

// Client-side helper for the server-side history backup (see
// app/api/history/route.ts). Used so chat history survives WebViews that
// evict localStorage (e.g. Telegram's in-app browser).

type BackupPayload = {
  clientId: string;
  chats: ReturnType<typeof loadChats>;
  lastChatId: string | null;
  messages?: Record<string, unknown[]>;
};

// Strip heavy base64 data URLs (file attachments) from anything we upload.
// The server restores conversation text, not raw file bytes; keeping these out
// of the payload saves a lot of bandwidth on mobile WebViews. The full files
// stay in localStorage (nova_files_*) and are only lost if that is evicted.
function stripFileDataUrls(messages: Record<string, unknown[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const chatId of Object.keys(messages)) {
    out[chatId] = messages[chatId].map((m: any) => ({
      ...m,
      parts: Array.isArray(m?.parts)
        ? m.parts.map((part: any) =>
            part?.type === "file" && typeof part?.url === "string" && part.url.startsWith("data:")
              ? { ...part, url: "" }
              : part
          )
        : m?.parts,
    }));
  }
  return out;
}

export type RestoredHistory = {
  chats: ReturnType<typeof loadChats>;
  lastChatId: string | null;
  messages: Record<string, unknown[]>;
};

async function pushToServer(payload: BackupPayload): Promise<boolean> {
  try {
    const response = await fetch("/api/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: payload.clientId,
        chats: payload.chats,
        lastChatId: payload.lastChatId,
        messages: payload.messages ? stripFileDataUrls(payload.messages) : undefined,
      }),
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPayload: BackupPayload | null = null;

function schedulePush(payload: BackupPayload) {
  if (pendingPayload) {
    // Merge pending messages so concurrent chats don't overwrite each other.
    pendingPayload = {
      ...payload,
      messages: {
        ...(pendingPayload.messages ?? {}),
        ...(payload.messages ?? {}),
      },
    };
  } else {
    pendingPayload = payload;
  }
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    const toSend = pendingPayload;
    pendingPayload = null;
    if (toSend && toSend.chats.length > 0) {
      void pushToServer(toSend);
    }
  }, 800);
}

/**
 * Debounced push of the current chat list + messages to the server backup.
 * Call this whenever chats or messages change.
 */
export function backupNow(options?: { messages?: Record<string, unknown[]> }) {
  if (typeof window === "undefined") return;
  const chats = loadChats();
  if (chats.length === 0) {
    // Everything was deleted locally — make sure the server backup forgets
    // it too, otherwise the chats would resurrect on the next restore.
    void clearBackup();
    return;
  }
  schedulePush({
    clientId: getClientId(),
    chats,
    lastChatId: loadLastChatId(),
    messages: options?.messages ?? undefined,
  });
}

/**
 * Immediate flush (used on pagehide/visibilitychange). Sends whatever is
 * pending plus the current state, with keepalive so the request survives
 * tab teardown.
 */
export function flushBackup(options?: { messages?: Record<string, unknown[]> }) {
  if (typeof window === "undefined") return;
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  const chats = loadChats();
  if (chats.length === 0) {
    void clearBackup();
    return;
  }
  // Merge with anything still pending (e.g. another chat's debounced save) so
  // the flush carries every chat's latest messages, not just this caller's.
  const messages = {
    ...(pendingPayload?.messages ?? {}),
    ...(options?.messages ?? {}),
  };
  pendingPayload = null;
  void pushToServer({
    clientId: getClientId(),
    chats,
    lastChatId: loadLastChatId(),
    messages: Object.keys(messages).length > 0 ? messages : undefined,
  });
}

/**
 * Remove the server-side backup — either one chat or (without chatId) the
 * whole history for this client. Called when the user deletes chats so they
 * don't resurrect from the backup on the next restore.
 */
export function clearBackup(chatId?: string): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/history", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: getClientId(), chatId }),
      keepalive: true,
    });
  } catch {
    // best effort — a stale backup may re-appear once, then be overwritten
  }
}

/**
 * Pull the server backup and, when the local store is empty (or missing
 * chats), merge the remote history in. Returns the restored chat list so the
 * caller can update React state.
 */
export async function restoreFromServer(): Promise<RestoredHistory | null> {
  if (typeof window === "undefined") return null;
  const clientId = getClientId();
  try {
    const response = await fetch(`/api/history?clientId=${encodeURIComponent(clientId)}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = (await response.json()) as RestoredHistory;
    if (!Array.isArray(data.chats) || data.chats.length === 0) return null;

    const changed = importAllHistory({ chats: data.chats, messages: data.messages });
    if (!changed) return null;

    const mergedChats = loadChats();
    if (data.lastChatId && !loadLastChatId()) {
      saveLastChatId(data.lastChatId);
    }
    return {
      chats: mergedChats,
      lastChatId: data.lastChatId ?? loadLastChatId(),
      messages: data.messages ?? {},
    };
  } catch {
    return null;
  }
}

/** Re-exported so callers don't need to import storage directly. */
export { getClientId };
