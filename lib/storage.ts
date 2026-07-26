"use client";

// Simple localStorage-backed persistence. No login / backend required —
// everything (chat list, pin state, model settings, and message history) lives in the browser.

export type StoredChat = {
  id: string;
  title: string;
  createdAt: string; // ISO string
  pinned?: boolean;
};

// --- MODEL SETTINGS TYPES & DEFAULTS ---
export type ModelParams = {
  temperature: number;
  topK: number;
  maxTokens: number;
};

export type ModelSettings = {
  instant: ModelParams;
  expert: ModelParams;
};

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  instant: {
    temperature: 0.7,
    topK: 40,
    maxTokens: 4096,
  },
  expert: {
    temperature: 0.7,
    topK: 40,
    maxTokens: 8192,
  },
};

// --- STORAGE KEYS ---
const CHATS_KEY = "nova_chats_v1";
const MESSAGES_PREFIX = "nova_messages_v1_";
const SETTINGS_KEY = "nova_model_settings_v1";

const messagesKey = (chatId: string) => `${MESSAGES_PREFIX}${chatId}`;

function isBrowser() {
  return typeof window !== "undefined";
}

// --- CHATS ---
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

// --- MESSAGES ---
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

// --- MODEL SETTINGS ---
export function loadModelSettings(): ModelSettings {
  if (!isBrowser()) return DEFAULT_MODEL_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_MODEL_SETTINGS;
    return { ...DEFAULT_MODEL_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_MODEL_SETTINGS;
  }
}

export function saveModelSettings(settings: ModelSettings) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // storage full / disabled — fail silently
  }
}