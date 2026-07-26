"use client";

// Simple localStorage-backed persistence. No login / backend required —
// everything (chat list, pin state, and message history) lives in the browser.

export type StoredChat = {
  id: string;
  title: string;
  createdAt: string; // ISO string
  pinned?: boolean;
};

const CHATS_KEY = "nova_chats_v1";
const MESSAGES_PREFIX = "nova_messages_v1_";
const messagesKey = (chatId: string) => `${MESSAGES_PREFIX}${chatId}`;

function isBrowser() {
  return typeof window !== "undefined";
}

export function loadChats(): StoredChat[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(CHATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChats(chats: StoredChat[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    // storage full / disabled — fail silently
  }
}

export function loadMessages<T = unknown>(chatId: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(messagesKey(chatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMessages(chatId: string, messages: unknown[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(messagesKey(chatId), JSON.stringify(messages));
  } catch {
    // storage full — drop silently rather than crash the chat
  }
}

export function deleteMessages(chatId: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(messagesKey(chatId));
}

export function deleteChat(chatId: string) {
  if (!isBrowser()) return;
  const chats = loadChats().filter((c) => c.id !== chatId);
  saveChats(chats);
  deleteMessages(chatId);
}

/** Wipes every chat and every chat's message history from localStorage. */
export function clearAllChats() {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key === CHATS_KEY || key.startsWith(MESSAGES_PREFIX))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // storage disabled — fail silently
  }
}
