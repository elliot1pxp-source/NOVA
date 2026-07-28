/**
 * Server-side storage abstraction.
 * Uses @vercel/kv (Redis) in production (Vercel), falls back to in-memory store in development.
 * For Vercel: You must set up a KV store in your Vercel dashboard:
 *   https://vercel.com/docs/storage/vercel-kv
 * That will automatically add KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN env vars.
 */

let kv: any = null;

async function getKv() {
  if (kv) return kv;
  try {
    const { kv: kvClient } = await import("@vercel/kv");
    kv = kvClient;
    return kv;
  } catch {
    return null;
  }
}

function isVercelProduction(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production";
}

// Fallback for local development: in-memory store (since file system doesn't work on Vercel)
// In production with proper KV setup, this won't be used
const memoryStore: Record<string, string> = {};

export async function readData<T = any>(key: string, defaultValue: T): Promise<T> {
  const kvClient = await getKv();
  
  if (kvClient && process.env.KV_URL) {
    // Use Vercel KV (Redis)
    try {
      const data = await kvClient.get(key);
      if (data === null || data === undefined) return defaultValue;
      return data as T;
    } catch (err) {
      console.error(`KV read error for ${key}:`, err);
      return defaultValue;
    }
  }
  
  if (isVercelProduction() && !process.env.KV_URL) {
    console.warn(`Vercel KV not configured. Set up a KV store in Vercel dashboard for persistent storage. Using in-memory store (data will be lost on cold start).`);
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
  const kvClient = await getKv();
  
  if (kvClient && process.env.KV_URL) {
    // Use Vercel KV (Redis)
    await kvClient.set(key, data);
    return;
  }
  
  if (isVercelProduction() && !process.env.KV_URL) {
    console.warn(`Vercel KV not configured. Data for "${key}" will not persist between cold starts.`);
  }
  
  // Fallback: in-memory store
  memoryStore[key] = JSON.stringify(data);
}

// Storage keys
export const STORAGE_KEYS = {
  PAID_CODES: "nova:paid-codes",
  GLOBAL_SETTINGS: "nova:global-settings",
} as const;
