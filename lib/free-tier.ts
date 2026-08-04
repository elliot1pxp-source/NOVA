import { readData, writeData, STORAGE_KEYS } from "@/lib/server-storage";

export type FreeTierUsage = {
  count: number;
  windowStart: string;
  blockedUntil?: string;
};

export const FREE_TIER_MESSAGE_LIMIT = 20;
export const FREE_TIER_BLOCK_DURATION_MS = 3 * 60 * 60 * 1000;
export const FREE_TIER_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000;

function createEmptyUsage(): FreeTierUsage {
  return {
    count: 0,
    windowStart: new Date(0).toISOString(),
  };
}

export async function getFreeTierUsage(clientId: string, chatId: string): Promise<FreeTierUsage> {
  const usage = await readData<Record<string, Record<string, FreeTierUsage>>>(STORAGE_KEYS.FREE_TIER_USAGE, {});
  const clientUsage = usage[clientId] ?? {};
  return clientUsage[chatId] ?? createEmptyUsage();
}

export async function saveFreeTierUsage(clientId: string, chatId: string, usageRecord: FreeTierUsage) {
  const usage = await readData<Record<string, Record<string, FreeTierUsage>>>(STORAGE_KEYS.FREE_TIER_USAGE, {});
  const clientUsage = usage[clientId] ?? {};
  usage[clientId] = {
    ...clientUsage,
    [chatId]: usageRecord,
  };
  await writeData(STORAGE_KEYS.FREE_TIER_USAGE, usage);
}

export function formatBlockedUntil(blockedUntil?: string): string | null {
  if (!blockedUntil) return null;
  const blockedDate = new Date(blockedUntil);
  return Number.isNaN(blockedDate.getTime()) ? null : blockedDate.toISOString();
}

export async function enforceFreeTierLimit(clientId: string, chatId: string) {
  const now = Date.now();
  const usageRecord = await getFreeTierUsage(clientId, chatId);
  const currentWindowStart = new Date(usageRecord.windowStart).getTime();
  const blockedUntil = usageRecord.blockedUntil ? new Date(usageRecord.blockedUntil).getTime() : 0;

  if (blockedUntil > now) {
    throw new Error("Free tier message limit reached: 20 messages. Please wait 3 hours for the reset or start a new chat.");
  }

  if (usageRecord.blockedUntil && blockedUntil <= now) {
    usageRecord.count = 0;
    usageRecord.blockedUntil = undefined;
    usageRecord.windowStart = new Date(now).toISOString();
  } else if (now - currentWindowStart >= FREE_TIER_USAGE_WINDOW_MS) {
    usageRecord.count = 0;
    usageRecord.blockedUntil = undefined;
    usageRecord.windowStart = new Date(now).toISOString();
  }

  if (usageRecord.count >= FREE_TIER_MESSAGE_LIMIT) {
    usageRecord.blockedUntil = new Date(now + FREE_TIER_BLOCK_DURATION_MS).toISOString();
    await saveFreeTierUsage(clientId, chatId, usageRecord);
    throw new Error("Free tier message limit reached: 20 messages. Please wait 3 hours for the reset or start a new chat.");
  }

  usageRecord.count += 1;
  if (usageRecord.count >= FREE_TIER_MESSAGE_LIMIT) {
    usageRecord.blockedUntil = new Date(now + FREE_TIER_BLOCK_DURATION_MS).toISOString();
  }

  await saveFreeTierUsage(clientId, chatId, usageRecord);
}

export async function getFreeTierStatus(clientId: string, chatId: string) {
  const now = Date.now();
  const usageRecord = await getFreeTierUsage(clientId, chatId);
  const blockedUntil = usageRecord.blockedUntil ? new Date(usageRecord.blockedUntil).getTime() : 0;
  const isBlocked = blockedUntil > now;
  const remaining = Math.max(FREE_TIER_MESSAGE_LIMIT - usageRecord.count, 0);
  const blockedUntilIso = isBlocked ? new Date(blockedUntil).toISOString() : undefined;

  return {
    count: usageRecord.count,
    remaining,
    blocked: isBlocked,
    blockedUntil: blockedUntilIso,
  };
}
