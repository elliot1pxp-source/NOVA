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
  coding: ModelParams;
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
  coding: {
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
// Edit/regenerate version snapshots (written by components/chat-view.tsx).
// Declared here so chat deletion can clean them up too — otherwise every
// deleted chat leaks its snapshots forever and eventually exhausts the quota,
// which makes saveMessages() fail and silently drop assistant replies.
export const BRANCHES_PREFIX = "nova-edit-branches:";

const messagesKey = (chatId: string) => `${MESSAGES_PREFIX}${chatId}`;
const filesKey = (chatId: string) => `${FILES_PREFIX}${chatId}`;
export const branchesKey = (chatId: string) => `${BRANCHES_PREFIX}${chatId}`;

// Stable, device-scoped identifier used for server-side history backup. It is
// written to BOTH a long-lived cookie and localStorage so that a WebView
// (e.g. Telegram's in-app browser) clearing localStorage cannot orphan the
// user's backup: the cookie usually survives, and even a full site-data wipe
// only costs a fresh id for genuinely brand-new visitors.
const CLIENT_ID_KEY = "nova_client_id_v1";
const CLIENT_ID_COOKIE = "nova_client_id_v1";

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

function writeCookie(name: string, value: string) {
  if (!isBrowser()) return;
  // 10-year expiry, available on every path, SameSite=Lax keeps it usable for
  // top-level navigations (the app is a SPA; no cross-site embedding needed).
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/; SameSite=Lax`;
}

export function getClientId(): string {
  if (!isBrowser()) return "";

  const fromCookie = readCookie(CLIENT_ID_COOKIE);
  if (fromCookie) {
    // Keep localStorage in sync so the server-mode logic that reads the id
    // from storage still works even if the cookie is ever stripped.
    try {
      if (window.localStorage.getItem(CLIENT_ID_KEY) !== fromCookie) {
        window.localStorage.setItem(CLIENT_ID_KEY, fromCookie);
      }
    } catch {
      // storage unavailable — the cookie alone is enough
    }
    return fromCookie;
  }

  const fromStorage = window.localStorage.getItem(CLIENT_ID_KEY);
  if (fromStorage) {
    writeCookie(CLIENT_ID_COOKIE, fromStorage);
    return fromStorage;
  }

  const generated = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  try {
    window.localStorage.setItem(CLIENT_ID_KEY, generated);
  } catch {
    // storage full / disabled — the cookie still carries the id
  }
  writeCookie(CLIENT_ID_COOKIE, generated);
  return generated;
}


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

/**
 * Strips heavy base64 file data URLs — the single biggest quota hog.
 */
function stripDataUrls(messages: Array<{ id?: string }>) {
  return messages.map((m: any) => ({
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

/**
 * Drops UI-only progress parts (reasoning transcripts, search results, file
 * scan chips). These can be tens of KB per message and are pure decoration —
 * losing them is always preferable to losing the assistant's actual answer.
 */
function stripProgressParts(messages: Array<{ id?: string }>) {
  return messages.map((m: any) => ({
    ...m,
    parts: Array.isArray(m?.parts)
      ? m.parts.filter((part: any) => !String(part?.type ?? "").startsWith("data-"))
      : m?.parts,
  }));
}

/**
 * Frees quota by deleting the version-snapshot blobs of OTHER chats. They are
 * a nice-to-have (the "< 2/3 >" switcher) and are stored redundantly, so they
 * are the correct thing to sacrifice to keep real conversations intact.
 */
function evictOtherChatBranchSnapshots(keepChatId: string): boolean {
  let evicted = false;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(BRANCHES_PREFIX) && key !== branchesKey(keepChatId)) {
        keys.push(key);
      }
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
      evicted = true;
    }
  } catch {
    // ignore — best effort
  }
  return evicted;
}

/**
 * Persists a chat's messages, degrading progressively rather than failing.
 *
 * A silent failure here was the cause of "NOVA's replies disappear": the last
 * write that fit was the one taken moments after the user hit send (containing
 * only their message), so the assistant's reply was never stored and the chat
 * reloaded as user-only. Every tier below is therefore attempted in order, and
 * the final tier keeps the most recent messages so SOMETHING survives.
 */
export function saveMessages(chatId: string, messages: unknown[]) {
  if (!isBrowser()) return;
  const deduped = dedupeById(messages as Array<{ id?: string }>);
  if (deduped.length === 0) return;

  const key = messagesKey(chatId);
  const write = (payload: unknown[]): boolean => {
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  };

  // Tier 1: everything.
  if (write(deduped)) return;
  // Tier 2: without base64 attachment payloads.
  const slim = stripDataUrls(deduped);
  if (write(slim)) return;
  // Tier 3: reclaim space from other chats' redundant version snapshots.
  if (evictOtherChatBranchSnapshots(chatId) && write(slim)) return;
  // Tier 4: without UI-only progress parts (thoughts / search / file scans).
  const minimal = stripProgressParts(slim);
  if (write(minimal)) return;
  // Tier 5: keep only the most recent messages. Never give up entirely —
  // truncated history beats a conversation that looks like it never happened.
  for (const limit of [100, 50, 20, 10, 4]) {
    if (minimal.length <= limit) continue;
    if (write(minimal.slice(-limit))) return;
  }
  // Storage is genuinely unusable (private mode / disabled). The server-side
  // backup remains the safety net.
  console.warn(`[storage] unable to persist messages for chat ${chatId}`);
}

export function deleteMessages(chatId: string) {
  if (!isBrowser()) return;
  window.localStorage.removeItem(messagesKey(chatId));
}

export function deleteBranchSnapshots(chatId: string) {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(branchesKey(chatId));
  } catch {
    // storage disabled — nothing to clean
  }
}

const BRANCH_GC_KEY = "nova_branch_gc_v1";

/**
 * One-time reclaim for users whose quota is ALREADY full of orphaned version
 * snapshots written by the previous (leaking) implementation. Without this,
 * existing users stay wedged — every save keeps failing until they manually
 * clear site data. Deletes snapshot blobs belonging to chats that no longer
 * exist, then marks itself done.
 */
export function reclaimOrphanedBranchSnapshots() {
  if (!isBrowser()) return;
  try {
    if (window.localStorage.getItem(BRANCH_GC_KEY)) return;
    const liveChatIds = new Set(loadChats().map((c) => c.id));
    const orphaned: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(BRANCHES_PREFIX)) continue;
      const chatId = key.slice(BRANCHES_PREFIX.length);
      if (!liveChatIds.has(chatId)) orphaned.push(key);
    }
    for (const key of orphaned) window.localStorage.removeItem(key);
    window.localStorage.setItem(BRANCH_GC_KEY, "1");
    if (orphaned.length > 0) {
      console.info(`[storage] reclaimed ${orphaned.length} orphaned branch snapshot(s)`);
    }
  } catch {
    // best effort
  }
}

export function deleteChat(chatId: string) {
  if (!isBrowser()) return;
  const chats = loadChats().filter((c) => c.id !== chatId);
  saveChats(chats);
  deleteMessages(chatId);
  deleteChatFiles(chatId);
  // Without this the version snapshots (which duplicate message content)
  // outlive the chat forever and slowly consume the whole quota.
  deleteBranchSnapshots(chatId);
}

/** Wipes every chat and every chat's message history and files from localStorage. */
export function exportAllHistory(): { chats: StoredChat[]; messages: Record<string, unknown[]> } {
  const chats = loadChats();
  const messages: Record<string, unknown[]> = {};
  for (const chat of chats) {
    const stored = loadMessages(chat.id);
    if (stored.length > 0) messages[chat.id] = stored;
  }
  return { chats, messages };
}

export function importAllHistory(history: { chats: StoredChat[]; messages?: Record<string, unknown[]> }): boolean {
  if (!isBrowser()) return false;
  if (!Array.isArray(history?.chats) || history.chats.length === 0) return false;
  const existing = new Set(loadChats().map((c) => c.id));
  const toAdd = history.chats.filter((c) => c && typeof c.id === "string" && !existing.has(c.id));
  let changed = false;
  if (toAdd.length > 0) {
    saveChats(dedupeById([...loadChats(), ...toAdd]));
    changed = true;
  }
  const remoteMessages = history.messages ?? {};
  for (const chatId of Object.keys(remoteMessages)) {
    const msgs = remoteMessages[chatId];
    if (!Array.isArray(msgs) || msgs.length === 0) continue;
    if (loadMessages(chatId).length > 0) continue; // local copy wins
    try {
      window.localStorage.setItem(messagesKey(chatId), JSON.stringify(dedupeById(msgs as Array<{ id?: string }>)));
      changed = true;
    } catch {
      // skip — server copy stays available for the next restore attempt
    }
  }
  return changed;
}

export function clearAllChats() {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (
        key &&
        (key === CHATS_KEY ||
          key.startsWith(MESSAGES_PREFIX) ||
          key.startsWith(FILES_PREFIX) ||
          key.startsWith(BRANCHES_PREFIX))
      ) {
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
      coding: { ...DEFAULT_MODEL_SETTINGS.coding, ...stored.coding },
    };
    // One-time migration: bump old maxTokens values up to the new default max.
    // After this runs once, the user can lower maxTokens and it will stick.
    if (!window.localStorage.getItem(SETTINGS_MIGRATION_KEY)) {
      merged.instant.maxTokens = DEFAULT_MODEL_SETTINGS.instant.maxTokens;
      merged.expert.maxTokens = DEFAULT_MODEL_SETTINGS.expert.maxTokens;
      merged.coding.maxTokens = DEFAULT_MODEL_SETTINGS.coding.maxTokens;
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