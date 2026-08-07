"use client";

// Simple localStorage-backed persistence. No login / backend required —
// everything (chat list, pin state, model settings, message history, and chat files) lives in the browser.

export type StoredChat = {
  id: string;
  title: string;
  createdAt: string; // ISO string
  pinned?: boolean;
};

// --- CHAT FILE TYPES ---
export type ChatFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
  createdAt: string; // ISO string
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
    maxTokens: 32768,
  },
  expert: {
    temperature: 0.7,
    topK: 40,
    maxTokens: 32768,
  },
};

// --- STORAGE KEYS ---
const CHATS_KEY = "nova_chats_v1";
const MESSAGES_PREFIX = "nova_messages_v1_";
const FILES_PREFIX = "nova_files_v1_";
const SETTINGS_KEY = "nova_model_settings_v1";
const SETTINGS_MIGRATION_KEY = "nova_model_settings_migrated_v2";
const LAST_CHAT_KEY = "nova_last_chat_v1";

const messagesKey = (chatId: string) => `${MESSAGES_PREFIX}${chatId}`;
const filesKey = (chatId: string) => `${FILES_PREFIX}${chatId}`;

function isBrowser() {
  return typeof window !== "undefined";
}

function dedupeById<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item?.id;
    if (typeof id !== "string" || id.length === 0) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// --- CHATS ---
export function loadChats(): StoredChat[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(CHATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupeById(parsed) : [];
  } catch {
    return [];
  }
}

export function saveChats(chats: StoredChat[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(CHATS_KEY, JSON.stringify(dedupeById(chats)));
  } catch {
    // storage full / disabled — fail silently
  }
}

export function loadLastChatId(): string | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(LAST_CHAT_KEY);
    return raw && typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastChatId(chatId: string) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(LAST_CHAT_KEY, chatId);
  } catch {
    // storage full / disabled — fail silently
  }
}

export function deleteLastChatId() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(LAST_CHAT_KEY);
}

// --- MESSAGES ---
export function loadMessages<T = unknown>(chatId: string): T[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(messagesKey(chatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return dedupeById(parsed as Array<{ id?: string }>) as T[];
  } catch {
    return [];
  }
}

export function saveMessages(chatId: string, messages: unknown[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(messagesKey(chatId), JSON.stringify(dedupeById(messages as Array<{ id?: string }>)));
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
  deleteChatFiles(chatId);
}

/** Wipes every chat and every chat's message history and files from localStorage. */
export function clearAllChats() {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && (key === CHATS_KEY || key.startsWith(MESSAGES_PREFIX) || key.startsWith(FILES_PREFIX))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // storage disabled — fail silently
  }
}

// --- CHAT FILES ---
export function loadChatFiles(chatId: string): ChatFile[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(filesKey(chatId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChatFiles(chatId: string, files: ChatFile[]) {
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(filesKey(chatId), JSON.stringify(files));
  } catch {
    // storage full — fail silently
  }
}

export function addChatFile(chatId: string, file: ChatFile) {
  const files = loadChatFiles(chatId);
  files.push(file);
  saveChatFiles(chatId, files);
}

export function deleteChatFile(chatId: string, fileId: string) {
  const files = loadChatFiles(chatId).filter((f) => f.id !== fileId);
  saveChatFiles(chatId, files);
}

export function deleteChatFiles(chatId: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(filesKey(chatId));
}

export function clearAllChatFiles() {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(FILES_PREFIX)) {
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
    const stored = JSON.parse(raw) as Partial<ModelSettings>;
    const merged: ModelSettings = {
      instant: { ...DEFAULT_MODEL_SETTINGS.instant, ...stored.instant },
      expert: { ...DEFAULT_MODEL_SETTINGS.expert, ...stored.expert },
    };
    // One-time migration: bump old maxTokens values up to the new default max.
    // After this runs once, the user can lower maxTokens and it will stick.
    if (!window.localStorage.getItem(SETTINGS_MIGRATION_KEY)) {
      merged.instant.maxTokens = DEFAULT_MODEL_SETTINGS.instant.maxTokens;
      merged.expert.maxTokens = DEFAULT_MODEL_SETTINGS.expert.maxTokens;
      window.localStorage.setItem(SETTINGS_MIGRATION_KEY, "1");
      saveModelSettings(merged);
    }
    return merged;
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