/**
 * Runtime-resolvable system prompt.
 *
 * The prompt is read LIVE on every chat request from the global settings
 * (admin-editable at runtime). There is no bundled-file fallback — the admin
 * panel is the single source of truth. An admin can edit the prompt and have
 * it apply to the very next request — no server restart required.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { readData, STORAGE_KEYS } from "@/lib/server-storage";

const INITIAL_PROMPT_FILE_CANDIDATES = [
  path.join(process.cwd(), "initial_prompt.txt"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../initial_prompt.txt"),
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../initial_prompt.txt"),
];

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
 * The SYSTEM_PROMPT value stored in global settings (admin-editable) is the
 * sole source of truth. There is no bundled-file fallback: when the setting is
 * empty, an empty prompt is returned and the model relies on its own defaults.
 */
export async function getEffectiveSystemPrompt(): Promise<string> {
  try {
    const settings = await readData<{ SYSTEM_PROMPT?: string }>(
      STORAGE_KEYS.GLOBAL_SETTINGS,
      {}
    );
    return settings.SYSTEM_PROMPT?.trim() ?? "";
  } catch {
    // If the store is unavailable, return an empty prompt.
    return "";
  }
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
