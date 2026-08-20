export type PaidCodeTokens = {
  MAIN_BASED_URL_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY: string;
  MAIN_BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
};

export type PaidCode = {
  code: string;
  expiresAt?: string | null;
  durationMinutes?: number;
  maxRedemptions?: number;
  redemptionCount?: number;
  redeemedUserIds?: string[];
  activatedAt?: string | null;
  tokens: PaidCodeTokens;
  redeemed: boolean;
  redeemedBy?: string | null;
  redeemedAt?: string | null;
};

export function getMaxRedemptions(code: PaidCode): number {
  const maxRedemptions = Number(code.maxRedemptions);
  return Number.isInteger(maxRedemptions) && maxRedemptions > 0 ? maxRedemptions : 1;
}

export function getRedeemedUserIds(code: PaidCode): string[] {
  return Array.isArray(code.redeemedUserIds) ? code.redeemedUserIds : [];
}

export function getRedemptionCount(code: PaidCode): number {
  const storedCount = Number(code.redemptionCount);
  if (Number.isInteger(storedCount) && storedCount >= 0) return storedCount;

  const userIds = getRedeemedUserIds(code);
  return userIds.length > 0 ? userIds.length : Number(code.redeemed);
}

export function hasRedeemedCode(code: PaidCode, userId: string): boolean {
  const userIds = getRedeemedUserIds(code);
  // Codes created before multi-user support had no per-user records.
  return userIds.length > 0 ? userIds.includes(userId) : code.redeemed;
}

export function isCodeExpired(code: PaidCode, now = new Date()): boolean {
  return Boolean(code.expiresAt && new Date(code.expiresAt) <= now);
}
