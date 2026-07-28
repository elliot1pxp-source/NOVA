"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Crown, CheckCircle, Clock, AlertTriangle, ArrowLeft, Globe, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPaidTierData, setPaidTierData, clearPaidTierData, isPaidUser, getServerMode, setServerMode, ServerMode } from "@/lib/paid-tier";

type DialogState = "enter-code" | "paid-user" | "expired";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export function PaidTierDialog({ isOpen, onClose }: Props) {
  const [dialogState, setDialogState] = useState<DialogState>("enter-code");
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState<Date | null>(null);
  const [timeLeft, setTimeLeft] = useState<string>("");
  const [serverMode, setLocalServerMode] = useState<ServerMode>("global");
  const [verifyingServer, setVerifyingServer] = useState(false);

  // Initialize state based on paid tier data - re-verify with server
  useEffect(() => {
    if (!isOpen) return;
    
    const mode = getServerMode();
    setLocalServerMode(mode);
    
    const paidData = getPaidTierData();
    if (paidData) {
      // Re-verify with server to check if still valid
      setVerifyingServer(true);
      fetch("/api/paid-tier/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: paidData.code }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.valid && data.data) {
            const expiry = new Date(data.data.expiresAt);
            if (expiry > new Date()) {
              // Update stored data with latest server info
              setPaidTierData({
                code: data.data.code,
                expiresAt: data.data.expiresAt,
                tokens: data.data.tokens,
                verified: true,
              });
              setDialogState("paid-user");
              setExpiresAt(expiry);
            } else {
              setDialogState("expired");
              clearPaidTierData();
            }
          } else {
            setDialogState("expired");
            clearPaidTierData();
          }
        })
        .catch(() => {
          // If server unreachable, use local data as fallback
          const expiry = new Date(paidData.expiresAt);
          if (expiry > new Date()) {
            setDialogState("paid-user");
            setExpiresAt(expiry);
          } else {
            setDialogState("expired");
            clearPaidTierData();
          }
        })
        .finally(() => setVerifyingServer(false));
    } else {
      setDialogState("enter-code");
      setCode("");
      setError("");
    }
  }, [isOpen]);

  // Countdown timer for paid users
  useEffect(() => {
    if (dialogState !== "paid-user" || !expiresAt) return;

    const updateTimer = () => {
      const now = new Date();
      const diff = expiresAt.getTime() - now.getTime();

      if (diff <= 0) {
        setDialogState("expired");
        clearPaidTierData();
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      let timeStr = "";
      if (days > 0) timeStr += `${days}d `;
      if (hours > 0 || days > 0) timeStr += `${hours}h `;
      timeStr += `${minutes}m ${seconds}s`;

      setTimeLeft(timeStr);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [dialogState, expiresAt]);

  const handleCheckCode = useCallback(async () => {
    if (!code.trim()) {
      setError("Please enter a code");
      return;
    }

    setChecking(true);
    setError("");

    try {
      const response = await fetch("/api/paid-tier/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });

      const data = await response.json();

      if (data.valid) {
        // Store paid tier data in localStorage
        setPaidTierData({
          code: data.data.code,
          expiresAt: data.data.expiresAt,
          tokens: data.data.tokens,
          verified: true,
        });

        // Auto-switch to paid server mode
        setServerMode("paid");
        setLocalServerMode("paid");

        setExpiresAt(new Date(data.data.expiresAt));
        setDialogState("paid-user");
        setCode("");
      } else {
        setError(data.error || "Invalid code");
      }
    } catch {
      setError("Failed to verify code. Please try again.");
    } finally {
      setChecking(false);
    }
  }, [code]);

  const handleToggleServerMode = useCallback((mode: ServerMode) => {
    setServerMode(mode);
    setLocalServerMode(mode);
  }, []);

  const handleBackToCodeEntry = useCallback(() => {
    setDialogState("enter-code");
    setCode("");
    setError("");
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    // Reset state after close animation
    setTimeout(() => {
      setDialogState("enter-code");
      setCode("");
      setError("");
    }, 300);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md px-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md rounded-[28px] bg-[#0d0d11]/95 border border-white/10 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Crown className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">Paid Tier</h2>
              <p className="text-[11px] text-[#8c8f9c]">Private dedicated server access</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-[#8c8f9c] hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Server Mode Toggle - always visible when paid user */}
        {(dialogState === "paid-user" || (getPaidTierData() !== null && getServerMode() === "global")) && (
          <div className="mb-4">
            <div className="flex items-center gap-1 bg-white/[0.03] border border-white/10 rounded-2xl p-1">
              <button
                type="button"
                onClick={() => handleToggleServerMode("global")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all",
                  serverMode === "global"
                    ? "bg-white/10 text-white border border-white/15 shadow-sm"
                    : "text-[#8c8f9c] hover:text-white hover:bg-white/5"
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                GLOBAL
              </button>
              <button
                type="button"
                onClick={() => handleToggleServerMode("paid")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-all",
                  serverMode === "paid"
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/25 shadow-sm"
                    : "text-[#8c8f9c] hover:text-white hover:bg-white/5"
                )}
              >
                <Server className="w-3.5 h-3.5" />
                PAID
              </button>
            </div>
            <p className="text-[10px] text-[#5e616e] text-center mt-1.5">
              {serverMode === "global" ? "Using global free server tokens" : "Using your private paid server tokens"}
            </p>
          </div>
        )}

        {/* Content based on state */}
        {verifyingServer ? (
          <div className="py-8 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10">
              <Clock className="w-4 h-4 text-amber-400 animate-spin" />
              <span className="text-xs text-[#8c8f9c]">Verifying your subscription...</span>
            </div>
          </div>
        ) : dialogState === "enter-code" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4">
              <p className="text-xs leading-relaxed text-[#ccc]">
                You can buy a private dedicated server that keeps you separated from the public free server, avoiding high demand and performance issues.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8c8f9c] mb-2">
                Enter the code that you bought to unlock a private server
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCheckCode();
                  }}
                  placeholder="Enter your paid tier code..."
                  className="flex-1 bg-white/[0.05] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  disabled={checking}
                />
                <button
                  type="button"
                  onClick={handleCheckCode}
                  disabled={checking || !code.trim()}
                  className="px-5 py-3 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-semibold hover:bg-amber-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
                >
                  {checking ? "Checking..." : "CHECK"}
                </button>
              </div>
              {error && (
                <p className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" />
                  {error}
                </p>
              )}
            </div>
          </div>
        )}

        {dialogState === "paid-user" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-500/5 border border-emerald-500/20 p-5 text-center">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                  <CheckCircle className="w-8 h-8 text-emerald-400" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-emerald-400 mb-1">YOU ARE A PAID USER!</h3>
              <p className="text-xs text-[#8c8f9c] mb-3">
                You have access to a private dedicated server
              </p>
              
              {/* Timer */}
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.05] border border-white/10">
                <Clock className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-mono font-semibold text-white tabular-nums">
                  {timeLeft || "Loading..."}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-center text-[#5e616e]">
              Your private server tokens are active. When the timer expires, you will be returned to the free tier.
            </p>
          </div>
        )}

        {dialogState === "expired" && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-rose-500/5 border border-rose-500/20 p-5 text-center">
              <div className="flex justify-center mb-3">
                <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/20">
                  <AlertTriangle className="w-8 h-8 text-rose-400" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-rose-400 mb-1">YOUR PAID TIER IS EXPIRED</h3>
              <p className="text-xs text-[#8c8f9c] mb-4">
                Your private server access has ended. You are now on the free tier.
              </p>
              <button
                type="button"
                onClick={handleBackToCodeEntry}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-white text-black hover:bg-white/90 text-xs font-semibold transition-all active:scale-95 shadow-md"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                OK
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end mt-5">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full bg-white/5 px-4 py-2 text-xs font-medium text-[#ccc] hover:bg-white/10 hover:text-white transition-all active:scale-95"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
