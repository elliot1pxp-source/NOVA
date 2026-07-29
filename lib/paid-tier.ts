"use client";

// Keys for localStorage
const PAID_TIER_KEY = "nova_paid_tier_v1";
const PAID_TIER_CLIENT_ID_KEY = "nova_paid_tier_client_id_v1";
const ADMIN_AUTH_KEY = "nova_admin_auth_v1";
const SERVER_MODE_KEY = "nova_server_mode_v1";

export type ServerMode = "global" | "paid";

// Types for paid tier data
export type PaidTierData = {
  code: string;
  expiresAt: string; // ISO string - server-controlled expiry
  tokens: {
    POLLINATIONS_API_KEY: string;
    DEEPTHINK_TOKEN: string;
    SERPER_API_KEY: string;
  };
  verified: boolean;
};

// Admin auth
export function isAdminAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ADMIN_AUTH_KEY) === "true";
}

export function setAdminAuthenticated(value: boolean) {
  if (typeof window === "undefined") return;
  if (value) {
    window.localStorage.setItem(ADMIN_AUTH_KEY, "true");
  } else {
    window.localStorage.removeItem(ADMIN_AUTH_KEY);
  }
}

export function logoutAdmin() {
  setAdminAuthenticated(false);
}

// Paid tier management
export function getPaidTierData(): PaidTierData | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PAID_TIER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PaidTierData;
    // Check if expired based on server-controlled expiry
    if (new Date(data.expiresAt) <= new Date()) {
      clearPaidTierData();
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setPaidTierData(data: PaidTierData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAID_TIER_KEY, JSON.stringify(data));
  } catch {
    // storage full / disabled — fail silently
  }
}

export function clearPaidTierData() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PAID_TIER_KEY);
  } catch {
    // fail silently
  }
}

export function getPaidTierClientId(): string {
  if (typeof window === "undefined") return "";

  const existingId = window.localStorage.getItem(PAID_TIER_CLIENT_ID_KEY);
  if (existingId) return existingId;

  const clientId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(PAID_TIER_CLIENT_ID_KEY, clientId);
  return clientId;
}

export function getPaidTierExpiryDate(): Date | null {
  const data = getPaidTierData();
  if (!data) return null;
  return new Date(data.expiresAt);
}

export function getPaidTierTokens() {
  const data = getPaidTierData();
  if (!data) return null;
  return data.tokens;
}

export function isPaidUser(): boolean {
  return getPaidTierData() !== null;
}

// Server mode (global vs paid)
export function getServerMode(): ServerMode {
  if (typeof window === "undefined") return "global";
  try {
    const mode = window.localStorage.getItem(SERVER_MODE_KEY);
    if (mode === "paid" || mode === "global") return mode;
    return "global";
  } catch {
    return "global";
  }
}

export function setServerMode(mode: ServerMode) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SERVER_MODE_KEY, mode);
  } catch {
    // fail silently
  }
}
