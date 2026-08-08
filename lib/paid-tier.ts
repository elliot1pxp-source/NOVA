"use client";

// Keys for localStorage
const PAID_TIER_KEY = "nova_paid_tier_v1";
const PAID_TIER_CLIENT_ID_KEY = "nova_paid_tier_client_id_v1";
const ADMIN_AUTH_KEY = "nova_admin_auth_v1";
const SERVER_MODE_KEY = "nova_server_mode_v1";
// The admin key is the credential for the admin API. It lives in sessionStorage
// (never localStorage) so it is dropped when the browser tab closes.
const ADMIN_KEY_SESSION_KEY = "nova_admin_key_session";

export type ServerMode = "global" | "paid";

// Types for paid tier data
export type PaidTierData = {
  code: string;
  expiresAt: string; // ISO string - server-controlled expiry
  tokens: {
    BLOCKRUN_API_KEY?: string;
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

/** The admin key as entered by the admin (session-scoped, cleared on tab close). */
export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(ADMIN_KEY_SESSION_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setAdminKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ADMIN_KEY_SESSION_KEY, key);
  } catch {
    // fail silently
  }
}

export function clearAdminKey() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ADMIN_KEY_SESSION_KEY);
  } catch {
    // fail silently
  }
}

export function logoutAdmin() {
  setAdminAuthenticated(false);
  clearAdminKey();
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

export async function refreshPaidTierStatus(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  const paidData = getPaidTierData();
  if (!paidData) {
    setServerMode("global");
    return false;
  }

  try {
    const response = await fetch("/api/paid-tier/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: paidData.code, clientId: getPaidTierClientId() }),
    });

    const data = await response.json();

    if (data.valid && data.data) {
      const expiry = new Date(data.data.expiresAt);
      if (expiry > new Date()) {
        setPaidTierData({
          code: data.data.code,
          expiresAt: data.data.expiresAt,
          tokens: data.data.tokens,
          verified: true,
        });
        setServerMode("paid");
        return true;
      }
    }

    clearPaidTierData();
    setServerMode("global");
    return false;
  } catch {
    const expiry = new Date(paidData.expiresAt);
    if (expiry > new Date()) {
      setServerMode("paid");
      return true;
    }

    clearPaidTierData();
    setServerMode("global");
    return false;
  }
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
