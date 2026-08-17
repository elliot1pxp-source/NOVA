/**
 * Runtime-resolvable system prompt.
 *
 * The prompt is read LIVE on every chat request: a value stored in the
 * global settings (admin-editable at runtime) takes priority, and we only
 * fall back to the bundled systemprompt.txt file when nothing is configured.
 * This means an admin can edit the prompt in the admin panel and have it
 * apply to the very next request — no server restart required.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";

const SYSTEM_PROMPT_FILE_CANDIDATES = [
  path.join(process.cwd(), "systemprompt.txt"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../systemprompt.txt"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../systemprompt.txt"),
];

const INITIAL_PROMPT_FILE_CANDIDATES = [
  path.join(process.cwd(), "initial_prompt.txt"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../initial_prompt.txt"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../initial_prompt.txt"),
];

/** Reads the bundled systemprompt.txt from disk. Returns "" when missing. */
export function readSystemPromptFile(): string {
  for (const filePath of SYSTEM_PROMPT_FILE_CANDIDATES) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8").trim();
      }
    } catch {
      // try next candidate
    }
  }
  return "";
}

/** Reads the bundled initial_prompt.txt from disk. Returns "" when missing. */
export function readInitialPromptFile(): string {
  for (const filePath of INITIAL_PROMPT_FILE_CANDIDATES) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8").trim();
      }
    } catch {
      // try next candidate
    }
  }
  return "";
}

/**
 * Returns the active system prompt for the chat runtime.
 *
 * Priority:
 *   1. SYSTEM_PROMPT stored in global settings (admin editor) — when non-empty.
 *   2. The bundled systemprompt.txt file on disk.
 */
export async function getEffectiveSystemPrompt(): Promise<string> {
  try {
    const settings = await readData<{ SYSTEM_PROMPT?: string }>(
      STORAGE_KEYS.GLOBAL_SETTINGS,
      {}
    );
    const configured = settings.SYSTEM_PROMPT?.trim();
    if (configured) {
      return configured;
    }
  } catch {
    // If the store is unavailable, fall through to the file default.
  }
  return readSystemPromptFile();
}

/**
 * Returns the active initial chat prompt for the chat runtime.
 *
 * Priority:
 *   1. INITIAL_CHAT_PROMPT stored in global settings (admin editor) — when non-empty.
 *   2. The bundled initial_prompt.txt file on disk.
 *   3. Hardcoded fallback "DO NOT OVERTHINK THIS".
 */
export async function getEffectiveInitialPrompt(): Promise<string> {
  try {
    const settings = await readData<{ INITIAL_CHAT_PROMPT?: string }>(
      STORAGE_KEYS.GLOBAL_SETTINGS,
      {}
    );
    const configured = settings.INITIAL_CHAT_PROMPT?.trim();
    if (configured) {
      return configured;
    }
  } catch {
    // If the store is unavailable, fall through to the file default.
  }
  const filePrompt = readInitialPromptFile();
  return filePrompt || "DO NOT OVERTHINK THIS";
}
