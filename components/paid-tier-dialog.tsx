"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Crown, CheckCircle, Clock, AlertTriangle, ArrowLeft, Globe, Server } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { getPaidTierClientId, getPaidTierData, setPaidTierData, clearPaidTierData, getServerMode, setServerMode, ServerMode, refreshPaidTierStatus } from "@/lib/paid-tier";

type DialogState = "enter-code" | "paid-user" | "expired";

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

// Marketing copy shown in the code-entry state (rendered as markdown).
const PAID_TIER_MARKDOWN = `## **Unlock all the NOVA's features and unlimited chatting without limit!**

**How does the Paid Tier Works:**

NOVA doesn't have a subscription service in the traditional sense.

Instead we use **one-time codes**.

**How does the Paid Tier (one-time codes) work:**

Admins create codes with:

- Duration in minutes (e.g., 30 days)
- Max redemptions (how many users can use it)

You redeem a code once — it's not a recurring subscription.

- The timer starts on first redemption (shared across all users who use that code)
- Once expired, you'll return to the limited free tier.

**What you get with a paid code:**

- No more 20-message free tier limit
- Uses the paid code's dedicated API keys (not shared with free users)
- No per-chat message caps

**There is no:**

- Monthly recurring billing
- Credit card signup
- Auto-renewal

**Pricing:**

- **$15** — 7 days
- **$35** — 30 days

Unlock all features and unlimited chatting for either plan!

Contact us at Telegram: [t.me/elliotpxp](https://t.me/elliotpxp)`;

const paidTierMarkdownComponents = {
  p({ children }: any) {
    return <p className="my-1.5 text-[13px] leading-relaxed text-[#ccc]">{children}</p>;
  },
  strong({ children }: any) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },
  ul({ children }: any) {
    return <ul className="space-y-1.5 my-2">{children}</ul>;
  },
  li({ children }: any) {
    return (
      <li className="flex items-start gap-2 text-[13px] leading-relaxed text-[#ccc]">
        <span className="text-amber-400/80 leading-relaxed select-none">•</span>
        <span>{children}</span>
      </li>
    );
  },
  a({ href, children }: any) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-amber-400 hover:text-amber-300 underline font-medium"
      >
        {children}
      </a>
    );
  },
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
      setVerifyingServer(true);
      void refreshPaidTierStatus()
        .then((isValid) => {
          const refreshedData = getPaidTierData();
          if (isValid && refreshedData) {
            const expiry = new Date(refreshedData.expiresAt);
            setDialogState("paid-user");
            setExpiresAt(expiry);
          } else {
            setDialogState("expired");
          }
        })
        .catch(() => {
          setDialogState("expired");
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
        body: JSON.stringify({ code: code.trim(), clientId: getPaidTierClientId() }),
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
        className="relative w-full max-w-2xl flex flex-col max-h-[88vh] overflow-hidden rounded-[28px] bg-[#0d0d11]/95 border border-white/10 p-6 sm:p-7 shadow-[0_20px_60px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Crown className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">Paid Tier</h2>
              <p className="text-[11px] text-[#8c8f9c]">One-time codes · No subscription</p>
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

        {/* Scrollable content */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
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
              {serverMode === "global" ? "Using Free Tier Mode" : "Using your Paid Tier Mode"}
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
            {/* Marketing copy */}
            <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 sm:p-5">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={paidTierMarkdownComponents}>
                {PAID_TIER_MARKDOWN}
              </ReactMarkdown>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#8c8f9c] mb-2">
                Have a code? Enter it below to unlock Paid Tier.
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
                You have access to Paid Tier. Enjoy your unlimited chatting experience!
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
              Access to the Paid Tier is active. When the timer expires, you will be returned to the Free Tier.
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end mt-5 pt-4 border-t border-white/5 flex-shrink-0">
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
