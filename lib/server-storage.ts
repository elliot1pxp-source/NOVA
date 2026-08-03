/**
 * Server-side storage abstraction.
 * Uses @vercel/kv (Redis) in production (Vercel), falls back to in-memory store in development.
 * For Vercel: You must set up a KV store in your Vercel dashboard:
 *   https://vercel.com/docs/storage/vercel-kv
 * That will automatically add KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN env vars.
 */

let kv: any = null;

function getKvConfig() {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN };
  }

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    };
  }

  return null;
}

async function getKv() {
  if (kv) return kv;

  const config = getKvConfig();
  if (!config) {
    throw new Error("Redis is not configured");
  }

  const { createClient } = await import("@vercel/kv");
  kv = createClient({ ...config, cache: "no-store" });
  return kv;
}

function isVercelProduction(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production";
}

function hasKvConfig(): boolean {
  return getKvConfig() !== null;
}

// Fallback for local development: in-memory store (since file system doesn't work on Vercel)
// In production with proper KV setup, this won't be used
const memoryStore: Record<string, string> = {};

export async function readData<T = any>(key: string, defaultValue: T): Promise<T> {
  if (hasKvConfig()) {
    const kvClient = await getKv();

    try {
      const data = await kvClient.get(key);
      if (data === null || data === undefined) return defaultValue;
      return data as T;
    } catch (err) {
      console.error(`KV read error for ${key}:`, err);
      throw new Error(`Unable to read persistent data for "${key}"`);
    }
  }
  
  if (isVercelProduction()) {
    throw new Error("Redis is not configured. Set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN for persistent storage.");
  }
  
  // Fallback: in-memory store (works in dev, but on Vercel data resets between cold starts)
  if (memoryStore[key] === undefined) {
    return defaultValue;
  }
  try {
    return JSON.parse(memoryStore[key]) as T;
  } catch {
    return defaultValue;
  }
}

export async function writeData<T = any>(key: string, data: T): Promise<void> {
  if (hasKvConfig()) {
    const kvClient = await getKv();

    await kvClient.set(key, data);
    return;
  }
  
  if (isVercelProduction()) {
    throw new Error("Redis is not configured. Set KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN for persistent storage.");
  }
  
  // Fallback: in-memory store
  memoryStore[key] = JSON.stringify(data);
}

// Storage keys
export const STORAGE_KEYS = {
  PAID_CODES: "nova:paid-codes",
  GLOBAL_SETTINGS: "nova:global-settings",
  FREE_TIER_USAGE: "nova:free-tier-usage",
} as const;
