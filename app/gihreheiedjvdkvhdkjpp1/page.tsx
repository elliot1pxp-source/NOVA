"use client";

import { useState, useEffect, useCallback } from "react";
import { Shield, Key, Plus, Trash2, Save, Crown, X, RefreshCw, CheckCircle, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAdminAuthenticated, setAdminAuthenticated, logoutAdmin } from "@/lib/paid-tier";

const ADMIN_KEY = "FHUDSFIUSFHIUFE3248328&^&@^#&@#^*@^";

type PaidCode = {
  code: string;
  expiresAt: string;
  tokens: {
    GOOGLE_GENERATIVE_AI_API_KEY: string;
    DEEPTHINK_TOKEN: string;
    SERPER_API_KEY: string;
  };
  redeemed: boolean;
  redeemedBy?: string | null;
  redeemedAt?: string | null;
};

type GlobalSettings = {
  GOOGLE_GENERATIVE_AI_API_KEY: string;
  DEEPTHINK_TOKEN: string;
  SERPER_API_KEY: string;
};

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loginKey, setLoginKey] = useState("");
  const [loginError, setLoginError] = useState("");
  const [codes, setCodes] = useState<PaidCode[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({
    GOOGLE_GENERATIVE_AI_API_KEY: "",
    DEEPTHINK_TOKEN: "",
    SERPER_API_KEY: "",
  });
  const [loading, setLoading] = useState(false);
  const [refreshingCodes, setRefreshingCodes] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // New code form
  const [newCode, setNewCode] = useState("");
  const [newExpiry, setNewExpiry] = useState("");
  const [newGoogleKey, setNewGoogleKey] = useState("");
  const [newDeepThink, setNewDeepThink] = useState("");
  const [newSerper, setNewSerper] = useState("");

  // Editing
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editTokens, setEditTokens] = useState<{ GOOGLE_GENERATIVE_AI_API_KEY: string; DEEPTHINK_TOKEN: string; SERPER_API_KEY: string } | null>(null);
  const [editExpiry, setEditExpiry] = useState("");

  const toDateTimeLocalValue = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
  };

  const loadCodes = useCallback(async () => {
    setRefreshingCodes(true);
    try {
      const response = await fetch("/api/admin/codes", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      const data = await response.json();

      if (!response.ok || !data.codes) {
        throw new Error(data.error || "Failed to load codes");
      }

      setCodes(data.codes);
    } catch {
      setMessage({ type: "error", text: "Failed to refresh codes" });
    } finally {
      setRefreshingCodes(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [codesRes, settingsRes] = await Promise.all([
        fetch("/api/admin/codes", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${ADMIN_KEY}` },
        }),
        fetch("/api/admin/global-settings", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${ADMIN_KEY}` },
        }),
      ]);

      const codesData = await codesRes.json();
      const settingsData = await settingsRes.json();

      if (codesData.codes) setCodes(codesData.codes);
      if (settingsData.settings) setSettings(settingsData.settings);
    } catch {
      setMessage({ type: "error", text: "Failed to load data" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setAuthenticated(isAdminAuthenticated());
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    void loadData();
    const intervalId = window.setInterval(() => {
      void loadCodes();
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, [authenticated, loadData, loadCodes]);

  const handleLogin = async () => {
    if (loginKey === ADMIN_KEY) {
      setAdminAuthenticated(true);
      setAuthenticated(true);
    } else {
      setLoginError("Invalid key");
    }
  };

  const handleLogout = () => {
    logoutAdmin();
    setAuthenticated(false);
  };

  const handleSaveGlobalSettings = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/global-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Global settings updated successfully!" });
      } else {
        setMessage({ type: "error", text: "Failed to update settings" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update settings" });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleAddCode = async () => {
    if (!newCode.trim() || !newExpiry) {
      setMessage({ type: "error", text: "Code and expiry date are required" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({
          code: newCode.trim(),
          expiresAt: new Date(newExpiry).toISOString(),
          tokens: {
            GOOGLE_GENERATIVE_AI_API_KEY: newGoogleKey,
            DEEPTHINK_TOKEN: newDeepThink,
            SERPER_API_KEY: newSerper,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Code created successfully!" });
        setNewCode("");
        setNewExpiry("");
        setNewGoogleKey("");
        setNewDeepThink("");
        setNewSerper("");
        loadData();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to create code" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to create code" });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleDeleteCode = async (code: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Code deleted" });
        loadData();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to delete code" });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleResetCode = async (code: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({
          code,
          redeemed: false,
          redeemedBy: null,
          redeemedAt: null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: `Code "${code}" has been reset!` });
        loadData();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset code" });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to reset code" });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleEditCode = async (code: string) => {
    if (!editTokens || !editExpiry) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({
          code,
          expiresAt: new Date(editExpiry).toISOString(),
          tokens: editTokens,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Code updated!" });
        setEditingCode(null);
        setEditTokens(null);
        setEditExpiry("");
        loadData();
      }
    } catch {
      setMessage({ type: "error", text: "Failed to update code" });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  // Login page
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#0d0d0d] flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-[28px] bg-[#0d0d11]/95 border border-white/10 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          <div className="flex justify-center mb-6">
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20">
              <Shield className="w-8 h-8 text-rose-400" />
            </div>
          </div>
          <h1 className="text-xl font-semibold text-white text-center mb-1">Admin Access</h1>
          <p className="text-xs text-[#8c8f9c] text-center mb-6">Enter the admin key to continue</p>

          <input
            type="password"
            value={loginKey}
            onChange={(e) => {
              setLoginKey(e.target.value);
              setLoginError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleLogin();
            }}
            placeholder="Enter admin key..."
            className="w-full bg-white/[0.05] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all mb-3"
          />

          {loginError && (
            <p className="text-xs text-rose-400 mb-3 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" />
              {loginError}
            </p>
          )}

          <button
            type="button"
            onClick={handleLogin}
            className="w-full px-4 py-3 rounded-2xl bg-white text-black hover:bg-white/90 text-xs font-semibold transition-all active:scale-95 shadow-md"
          >
            Unlock
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0d0d0d]/95 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <Shield className="w-5 h-5 text-rose-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-white">Admin Panel</h1>
              <p className="text-[11px] text-[#8c8f9c]">Manage codes & global settings</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadCodes}
              disabled={refreshingCodes}
              className="p-2 rounded-lg text-[#8c8f9c] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Refresh code list"
              aria-label="Refresh code list"
            >
              <RefreshCw className={cn("w-4 h-4", refreshingCodes && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-400 text-xs font-medium hover:bg-rose-500/20 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Toast Message */}
      {message && (
        <div className={cn(
          "fixed top-4 right-4 z-50 px-4 py-2.5 rounded-2xl text-xs font-medium shadow-lg animate-in slide-in-from-top-2 duration-200",
          message.type === "success" ? "bg-emerald-500/20 border border-emerald-500/30 text-emerald-400" : "bg-rose-500/20 border border-rose-500/30 text-rose-400"
        )}>
          <div className="flex items-center gap-2">
            {message.type === "success" ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {message.text}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* Global Settings Section */}
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
              <Key className="w-4 h-4 text-[#8c8f9c]" />
            </div>
            <h2 className="text-sm font-semibold">Global Server Settings</h2>
            <span className="text-[10px] text-[#5e616e] bg-white/[0.04] px-2 py-0.5 rounded-md">Free Users & Expired</span>
          </div>

          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#8c8f9c] mb-1.5">GOOGLE_GENERATIVE_AI_API_KEY</label>
              <input
                type="text"
                value={settings.GOOGLE_GENERATIVE_AI_API_KEY}
                onChange={(e) => setSettings({ ...settings, GOOGLE_GENERATIVE_AI_API_KEY: e.target.value })}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                placeholder="Enter Google API key..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8c8f9c] mb-1.5">DEEPTHINK_TOKEN</label>
              <input
                type="text"
                value={settings.DEEPTHINK_TOKEN}
                onChange={(e) => setSettings({ ...settings, DEEPTHINK_TOKEN: e.target.value })}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                placeholder="Enter DeepThink token..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8c8f9c] mb-1.5">SERPER_API_KEY</label>
              <input
                type="text"
                value={settings.SERPER_API_KEY}
                onChange={(e) => setSettings({ ...settings, SERPER_API_KEY: e.target.value })}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                placeholder="Enter Serper API key..."
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveGlobalSettings}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                Apply Global Settings
              </button>
            </div>
          </div>
        </section>

        {/* Paid Codes Section */}
        <section>
          <div className="flex items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
              <Crown className="w-4 h-4 text-amber-400" />
            </div>
            <h2 className="text-sm font-semibold">Paid Tier Codes</h2>
            <span className="text-[10px] text-[#5e616e] bg-white/[0.04] px-2 py-0.5 rounded-md">{codes.length} codes</span>
            <button
              type="button"
              onClick={loadCodes}
              disabled={refreshingCodes}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-[#8c8f9c] hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50"
              title="Refresh code list"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", refreshingCodes && "animate-spin")} />
              Refresh
            </button>
          </div>

          {/* Add new code form */}
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 mb-4">
            <h3 className="text-xs font-semibold text-[#ccc] mb-3 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              Create New Code
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">Code</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="e.g. NOVA-PREMIUM-2025"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">Expiry Date</label>
                <input
                  type="datetime-local"
                  value={newExpiry}
                  onChange={(e) => setNewExpiry(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-white/20 transition-all"
                />
              </div>
            </div>
            <div className="space-y-3 mb-3">
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">GOOGLE_GENERATIVE_AI_API_KEY (for this code)</label>
                <input
                  type="text"
                  value={newGoogleKey}
                  onChange={(e) => setNewGoogleKey(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter Google API key for this code..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">DEEPTHINK_TOKEN (for this code)</label>
                <input
                  type="text"
                  value={newDeepThink}
                  onChange={(e) => setNewDeepThink(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter DeepThink token for this code..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">SERPER_API_KEY (for this code)</label>
                <input
                  type="text"
                  value={newSerper}
                  onChange={(e) => setNewSerper(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter Serper API key for this code..."
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAddCode}
                disabled={loading || !newCode.trim() || !newExpiry}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/30 transition-all active:scale-95 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Code
              </button>
            </div>
          </div>

          {/* Codes list */}
          {codes.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#5e616e] bg-white/[0.02] border border-white/5 rounded-2xl">
              No codes created yet
            </div>
          ) : (
            <div className="space-y-2">
              {codes.map((code) => {
                const isExpired = new Date(code.expiresAt) <= new Date();
                return (
                  <div
                    key={code.code}
                    className={cn(
                      "rounded-2xl border p-4 transition-colors",
                      code.redeemed
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : isExpired
                        ? "bg-rose-500/5 border-rose-500/20"
                        : "bg-white/[0.03] border-white/10"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-mono font-semibold text-white">{code.code}</span>
                        {code.redeemed ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Redeemed
                          </span>
                        ) : isExpired ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Expired
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleResetCode(code.code)}
                          disabled={loading}
                          className="p-1.5 rounded-lg text-[#8c8f9c] hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                          title="Reset code (make available again)"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCode(code.code)}
                          disabled={loading}
                          className="p-1.5 rounded-lg text-[#8c8f9c] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Delete code"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] text-[#8c8f9c] mb-2 flex items-center gap-1.5">
                      <Clock className="w-3 h-3" />
                      Expires: {new Date(code.expiresAt).toLocaleString()}
                      {isExpired && !code.redeemed && <span className="text-rose-400"> (Expired)</span>}
                    </div>

                    {/* Edit code button */}
                    {editingCode === code.code ? (
                      <div className="space-y-2 mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">Expiry Date</label>
                          <input
                            type="datetime-local"
                            value={editExpiry}
                            onChange={(e) => setEditExpiry(e.target.value)}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">GOOGLE_GENERATIVE_AI_API_KEY</label>
                          <input
                            type="text"
                            value={editTokens?.GOOGLE_GENERATIVE_AI_API_KEY || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, GOOGLE_GENERATIVE_AI_API_KEY: e.target.value })}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">DEEPTHINK_TOKEN</label>
                          <input
                            type="text"
                            value={editTokens?.DEEPTHINK_TOKEN || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, DEEPTHINK_TOKEN: e.target.value })}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">SERPER_API_KEY</label>
                          <input
                            type="text"
                            value={editTokens?.SERPER_API_KEY || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, SERPER_API_KEY: e.target.value })}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => { setEditingCode(null); setEditTokens(null); setEditExpiry(""); }}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#ccc] hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditCode(code.code)}
                            disabled={loading || !editExpiry}
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 text-white text-[10px] font-semibold hover:bg-white/15 transition-all active:scale-95"
                          >
                            <Save className="w-3 h-3" />
                            Save Code
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCode(code.code);
                          setEditTokens({ ...code.tokens });
                          setEditExpiry(toDateTimeLocalValue(code.expiresAt));
                        }}
                        className="text-[11px] text-[#8c8f9c] hover:text-white transition-colors flex items-center gap-1"
                      >
                        <Key className="w-3 h-3" />
                        Edit code
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
