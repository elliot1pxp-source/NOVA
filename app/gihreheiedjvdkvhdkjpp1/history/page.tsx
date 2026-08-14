"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, AlertTriangle } from "lucide-react";
import { getAdminKey } from "@/lib/paid-tier";
import { cn } from "@/lib/utils";

type ModelMap = Record<string, string>;

type GlobalSettings = {
  BLOCKRUN_API_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY?: string;
  BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
  useFallbackAsPrimary?: boolean;
  PRIMARY_MODELS?: ModelMap;
  FALLBACK_MODELS?: ModelMap;
  SYSTEM_PROMPT?: string;
};

type GlobalSettingsHistoryEntry = {
  id: string;
  timestamp: string;
  label: string;
  changedBy: string;
  before: GlobalSettings;
  after: GlobalSettings;
  changes: Record<string, { before: any; after: any }>;
};

const formatHistoryValue = (value: any): string => {
  if (value === null || value === undefined) return "(not set)";
  if (typeof value === "string") return value || "(empty)";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
};

export default function GlobalSettingsHistoryPage() {
  const [history, setHistory] = useState<GlobalSettingsHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadHistory = async () => {
      const adminKey = getAdminKey();
      if (!adminKey) {
        setError("Admin authentication required. Please sign in from the admin panel.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetch("/api/admin/global-settings/history", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${adminKey}`,
          },
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load history");
        }

        setHistory(data.history ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    void loadHistory();
  }, []);

  return (
    <div className="min-h-screen bg-[#0d0d0d] text-white">
      <div className="sticky top-0 z-50 bg-[#0d0d0d]/95 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/gihreheiedjvdkvhdkjpp1"
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-[#c1c5d0] hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </Link>
          <div>
            <h1 className="text-base font-semibold">Global Settings History</h1>
            <p className="text-[11px] text-[#8c8f9c]">Audit log of configuration changes and saved metadata.</p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {loading ? (
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 text-sm text-[#c1c5d0]">Loading history…</div>
        ) : error ? (
          <div className="rounded-2xl bg-rose-500/10 border border-rose-500/20 p-6 text-sm text-rose-200">{error}</div>
        ) : history.length === 0 ? (
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-6 text-sm text-[#c1c5d0]">
            No history entries found. Save global settings from the admin panel to create audit records.
          </div>
        ) : (
          <div className="space-y-4">
            {history.map((entry) => (
              <div key={entry.id} className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <h2 className="text-sm font-semibold text-white">{entry.label || "Global settings updated"}</h2>
                    <p className="text-[11px] text-[#8c8f9c]">{new Date(entry.timestamp).toLocaleString()} · {entry.changedBy}</p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">
                    <Clock className="w-3 h-3" />
                    {Object.keys(entry.changes).length} change{Object.keys(entry.changes).length === 1 ? "" : "s"}
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  {Object.entries(entry.changes).map(([key, change]) => (
                    <div key={key} className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold text-white">{key}</p>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">Edited</span>
                      </div>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <div className="rounded-xl bg-[#111217] p-3 text-[11px] text-[#c1c5d0]">
                          <div className="font-semibold text-[#8c8f9c] mb-1">Before</div>
                          <pre className="whitespace-pre-wrap break-words text-[11px] leading-5">{formatHistoryValue(change.before)}</pre>
                        </div>
                        <div className="rounded-xl bg-[#111217] p-3 text-[11px] text-[#c1c5d0]">
                          <div className="font-semibold text-[#8c8f9c] mb-1">After</div>
                          <pre className="whitespace-pre-wrap break-words text-[11px] leading-5">{formatHistoryValue(change.after)}</pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
