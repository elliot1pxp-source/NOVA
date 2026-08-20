"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Shield, Key, Plus, Trash2, Save, Crown, X, RefreshCw, CheckCircle, AlertTriangle, Clock, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIMARY_MODELS, FALLBACK_MODELS } from "@/lib/llm-providers";
import {
  isAdminAuthenticated,
  setAdminAuthenticated,
  logoutAdmin,
  getAdminKey,
  setAdminKey,
} from "@/lib/paid-tier";

// Renders text with `find` occurrences wrapped in a <mark>, used as a backdrop
// layer behind a transparent <textarea> to highlight matches. The active match
// (the one Find Next/Prev is currently on) is highlighted more strongly. Text
// is emitted as React nodes (never HTML), so there is no injection risk.
function HighlightedText({ text, find, activeIndex }: { text: string; find: string; activeIndex?: number }) {
  if (!find) return <>{text}</>;
  const segments: ReactNode[] = [];
  let rest = text;
  let key = 0;
  let pos = rest.indexOf(find);
  let matchNo = 0;
  while (pos !== -1) {
    if (pos > 0) segments.push(rest.slice(0, pos));
    const isActive = matchNo === activeIndex;
    segments.push(
      <mark
        key={key++}
        className={cn(
          "rounded-[2px] text-transparent",
          isActive ? "bg-amber-300 ring-1 ring-amber-200" : "bg-amber-400/50"
        )}
      >
        {find}
      </mark>
    );
    matchNo++;
    rest = rest.slice(pos + find.length);
    pos = rest.indexOf(find);
  }
  if (rest) segments.push(rest);
  return <>{segments}</>;
}

type PaidCode = {
  code: string;
  expiresAt?: string | null;
  durationMinutes?: number;
  maxRedemptions?: number;
  redemptionCount?: number;
  redeemedUserIds?: string[];
  activatedAt?: string | null;
  tokens: {
    BLOCKRUN_API_KEY?: string;
    FALLBACK_API_KEY?: string;
    SERPER_API_KEY: string;
    BASED_URL?: string;
    FALLBACK_BASED_URL?: string;
  };
  redeemed: boolean;
  redeemedBy?: string | null;
  redeemedAt?: string | null;
};

type GlobalSettings = {
  BLOCKRUN_API_KEY?: string;
  FALLBACK_API_KEY?: string;
  SERPER_API_KEY?: string;
  BASED_URL?: string;
  FALLBACK_BASED_URL?: string;
  useFallbackAsPrimary?: boolean;
  PRIMARY_MODELS?: Record<string, string>;
  FALLBACK_MODELS?: Record<string, string>;
  /** When true, chat history is converted to a single string and injected into the system prompt instead of being sent as a messages array. Useful for web-cookie models that don't support message arrays. */
  stringBasedChatHistory?: boolean;
  /** When true, automatically detect web-cookie models (containing "web" in model name) and apply string-based chat history. */
  autoDetectWebCookieModels?: boolean;
  /** Live-editable system prompt. Non-empty overrides the bundled systemprompt.txt. */
  SYSTEM_PROMPT?: string;
  /** Live-editable initial chat prompt. Non-empty overrides the bundled initial_prompt.txt. */
  INITIAL_CHAT_PROMPT?: string;
  /** When true, apply INITIAL_CHAT_PROMPT to every message. When false, only apply on chat start. */
  applyInitialPromptToEveryMessage?: boolean;
};

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loginKey, setLoginKey] = useState("");
  const [loginError, setLoginError] = useState("");
  const [codes, setCodes] = useState<PaidCode[]>([]);
  const [settings, setSettings] = useState<GlobalSettings>({
    useFallbackAsPrimary: false,
    PRIMARY_MODELS: PRIMARY_MODELS,
    FALLBACK_MODELS: FALLBACK_MODELS,
  });
  const [envValues, setEnvValues] = useState({
    ADMIN_KEY: "",
    BLOCKRUN_API_KEY: "",
    FALLBACK_API_KEY: "",
    SERPER_API_KEY: "",
    BASED_URL: "",
    FALLBACK_BASED_URL: "",
  });
  const [currentEnvironmentInputs, setCurrentEnvironmentInputs] = useState({
    ADMIN_KEY: "",
    SERPER_API_KEY: "",
    PRIMARY_KEY: "",
    FALLBACK_KEY: "",
    PRIMARY_ENDPOINT: "",
    FALLBACK_ENDPOINT: "",
  });
  const [loading, setLoading] = useState(false);
  const [refreshingCodes, setRefreshingCodes] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [changeReason, setChangeReason] = useState<string>("");

  // System prompt editor (live runtime)
  const [fileSystemPrompt, setFileSystemPrompt] = useState("");
  const [fileInitialPrompt, setFileInitialPrompt] = useState("");
  const [expandScreen, setExpandScreen] = useState(false);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1);
  const [goToLineValue, setGoToLineValue] = useState("");
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const expandedTextareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Keep the highlight backdrop scrolled in lockstep with the textarea.
  const syncBackdropScroll = () => {
    const ta = expandedTextareaRef.current;
    const bd = backdropRef.current;
    const ln = lineNumbersRef.current;
    if (ta && bd) {
      bd.scrollTop = ta.scrollTop;
      bd.scrollLeft = ta.scrollLeft;
    }
    if (ta && ln) {
      ln.scrollTop = ta.scrollTop;
    }
  };

  // Handle keyboard shortcuts in the expanded editor
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab key for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const { selectionStart, selectionEnd } = ta;
      const newText = ta.value.slice(0, selectionStart) + "  " + ta.value.slice(selectionEnd);
      ta.value = newText;
      ta.setSelectionRange(selectionStart + 2, selectionStart + 2);
      // Trigger onChange to update state
      const event = new Event("change", { bubbles: true });
      ta.dispatchEvent(event);
    }
    // Ctrl+F - Find
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      // Focus find input
      setTimeout(() => {
        const findInput = document.querySelector('input[placeholder="Text to find"]') as HTMLInputElement;
        if (findInput) findInput.focus();
      }, 0);
    }
    // Ctrl+H - Replace
    if (e.ctrlKey && e.key === "h") {
      e.preventDefault();
      const findInput = document.querySelector('input[placeholder="Text to find"]') as HTMLInputElement;
      if (findInput) findInput.focus();
    }
    // Ctrl+G - Go to line
    if (e.ctrlKey && e.key === "g") {
      e.preventDefault();
      const lineInput = document.querySelector('input[placeholder="Line number"]') as HTMLInputElement;
      if (lineInput) lineInput.focus();
    }
    // Escape - clear selection
    if (e.key === "Escape") {
      const ta = e.currentTarget;
      ta.setSelectionRange(ta.selectionStart, ta.selectionStart);
    }
  };

  // Get the active line number based on cursor position
  const getActiveLineNumber = () => {
    const ta = expandedTextareaRef.current;
    if (!ta) return undefined;
    const { selectionStart } = ta;
    return ta.value.slice(0, selectionStart).split("\n").length;
  };

  // Go to specific line number
  const handleGoToLine = () => {
    if (!goToLineValue.trim()) return;
    const ta = expandedTextareaRef.current;
    if (!ta) return;
    const lineNum = Math.max(1, parseInt(goToLineValue.trim(), 10));
    const lines = ta.value.split("\n");
    const targetLine = Math.min(lineNum, lines.length);
    const start = lines.slice(0, targetLine - 1).join("\n").length + (targetLine > 1 ? 1 : 0);
    ta.setSelectionRange(start, start);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    ta.scrollTop = Math.max(0, (targetLine - 1) * lh - ta.clientHeight / 2);
    syncBackdropScroll();
    ta.focus();
  };

  // All non-overlapping start offsets of the current find term.
  const promptText = settings.SYSTEM_PROMPT ?? "";
  const findMatches: number[] = (() => {
    if (!findText) return [];
    const out: number[] = [];
    let from = 0;
    let p = promptText.indexOf(findText, from);
    while (p !== -1) {
      out.push(p);
      from = p + findText.length;
      p = promptText.indexOf(findText, from);
    }
    return out;
  })();

  // Step through matches one by one (Find Next / Previous), selecting the match
  // and scrolling its line into view. `raw` may go out of range — it wraps.
  const goToMatch = (raw: number) => {
    if (findMatches.length === 0) return;
    const idx = ((raw % findMatches.length) + findMatches.length) % findMatches.length;
    const ta = expandedTextareaRef.current;
    if (!ta) return;
    const start = findMatches[idx];
    const end = start + findText.length;
    ta.focus();
    ta.setSelectionRange(start, end);
    const lineNum = promptText.slice(0, start).split("\n").length;
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 22;
    ta.scrollTop = Math.max(0, (lineNum - 1) * lh - ta.clientHeight / 2);
    syncBackdropScroll();
    setMatchIndex(idx);
  };

  // Reset the active match whenever the find term changes.
  useEffect(() => {
    setMatchIndex(-1);
  }, [findText]);

  // Re-sync the highlight layer after open / content changes.
  useEffect(() => {
    if (expandScreen) requestAnimationFrame(syncBackdropScroll);
  }, [expandScreen, settings.SYSTEM_PROMPT]);

  // Lock body scroll when expanded editor is open
  useEffect(() => {
    if (expandScreen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [expandScreen]);

  // Generate line numbers for the gutter
  const generateLineNumbers = (text: string, activeLine?: number) => {
    // Normalize line count — split by \n preserves empty lines correctly
    // e.g., "a\n\nb" -> ["a", "", "b"] (3 lines), "a\n" -> ["a", ""] (2 lines)
    const lines = text.length > 0 ? text.split("\n") : [""];
    const numLines = lines.length;
    return Array.from({ length: numLines }, (_, i) => {
      const lineNum = i + 1;
      return (
        <div
          key={i}
          className={cn(
            "select-none text-right pr-2 text-sm leading-relaxed border-r border-white/5",
            // Only first line gets pt-4 to match textarea's p-4 top padding.
            // Subsequent lines use leading-relaxed only to match textarea's line-height spacing.
            i === 0 ? "pt-4" : "",
            activeLine === lineNum ? "text-amber-400 font-medium" : "text-[#4a4d5a]"
          )}
        >
          {lineNum}
        </div>
      );
    });
  };

  // New code form
  const [newCode, setNewCode] = useState("");
  const [newDurationHours, setNewDurationHours] = useState("24");

  const generateRandomCode = () => {
    const duration = newDurationHours || "24";
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // excluding I, O for clarity
    const numbers = '23456789'; // excluding 0, 1 for clarity

    let randomPart = '';
    // 3 random letters
    for (let i = 0; i < 3; i++) {
      randomPart += letters[Math.floor(Math.random() * letters.length)];
    }
    // 3 random numbers
    for (let i = 0; i < 3; i++) {
      randomPart += numbers[Math.floor(Math.random() * numbers.length)];
    }

    return `NOVA-${duration}-${randomPart}`;
  };
  const [newMaxRedemptions, setNewMaxRedemptions] = useState("1");
  const [newBlockrunApiKey, setNewBlockrunApiKey] = useState("");
  const [newFallbackApiKey, setNewFallbackApiKey] = useState("");
  const [newSerper, setNewSerper] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newFallbackBaseUrl, setNewFallbackBaseUrl] = useState("");

  // Editing
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editTokens, setEditTokens] = useState<{ BLOCKRUN_API_KEY?: string; FALLBACK_API_KEY?: string; SERPER_API_KEY: string; BASED_URL?: string; FALLBACK_BASED_URL?: string } | null>(null);
  const [editExpiry, setEditExpiry] = useState("");
  const [editDurationHours, setEditDurationHours] = useState("");
  const [editMaxRedemptions, setEditMaxRedemptions] = useState("");

  const toDateTimeLocalValue = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - timezoneOffsetMs).toISOString().slice(0, 16);
  };

  const adminHeaders = (): Record<string, string> => {
    const adminKey = getAdminKey();
    return {
      ...(adminKey ? { Authorization: `Bearer ${adminKey}` } : {}),
    };
  };

  const loadCodes = useCallback(async () => {
    setRefreshingCodes(true);
    try {
      const response = await fetch("/api/admin/codes", {
        cache: "no-store",
        headers: adminHeaders(),
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

  const buildCurrentEnvironmentInputs = (settings: GlobalSettings, env: typeof envValues) => ({
    ADMIN_KEY: env.ADMIN_KEY ?? "",
    SERPER_API_KEY: settings.SERPER_API_KEY || env.SERPER_API_KEY || "",
    PRIMARY_KEY: settings.useFallbackAsPrimary
      ? settings.FALLBACK_API_KEY || env.FALLBACK_API_KEY || ""
      : settings.BLOCKRUN_API_KEY || env.BLOCKRUN_API_KEY || "",
    FALLBACK_KEY: settings.useFallbackAsPrimary
      ? settings.BLOCKRUN_API_KEY || env.FALLBACK_API_KEY || ""
      : settings.FALLBACK_API_KEY || env.FALLBACK_API_KEY || "",
    PRIMARY_ENDPOINT: settings.useFallbackAsPrimary
      ? settings.FALLBACK_BASED_URL || env.FALLBACK_BASED_URL || ""
      : settings.BASED_URL || env.BASED_URL || "",
    FALLBACK_ENDPOINT: settings.useFallbackAsPrimary
      ? settings.BASED_URL || env.BASED_URL || ""
      : settings.FALLBACK_BASED_URL || env.FALLBACK_BASED_URL || "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [codesRes, settingsRes] = await Promise.all([
        fetch("/api/admin/codes", {
          cache: "no-store",
          headers: adminHeaders(),
        }),
        fetch("/api/admin/global-settings", {
          cache: "no-store",
          headers: adminHeaders(),
        }),
      ]);

      const codesData = await codesRes.json();
      const settingsData = await settingsRes.json();

      if (!codesRes.ok || !settingsRes.ok) {
        throw new Error(codesData.error || settingsData.error || "Failed to load data");
      }

      if (codesData.codes) setCodes(codesData.codes);
      if (settingsData.settings) {
        const loadedSettings = {
          ...settingsData.settings,
          useFallbackAsPrimary: Boolean(settingsData.settings.useFallbackAsPrimary),
          PRIMARY_MODELS: settingsData.settings.PRIMARY_MODELS ?? PRIMARY_MODELS,
          FALLBACK_MODELS: settingsData.settings.FALLBACK_MODELS ?? FALLBACK_MODELS,
          // Prefill the editor with whatever is currently active at runtime.
          SYSTEM_PROMPT: settingsData.effectiveSystemPrompt ?? settingsData.settings.SYSTEM_PROMPT ?? "",
          INITIAL_CHAT_PROMPT: settingsData.settings.INITIAL_CHAT_PROMPT ?? "",
        };
        setSettings(loadedSettings);
        setFileInitialPrompt(settingsData.fileInitialPrompt ?? "");
        setCurrentEnvironmentInputs(buildCurrentEnvironmentInputs(loadedSettings, settingsData.env ?? {
          ADMIN_KEY: "",
          BLOCKRUN_API_KEY: "",
          FALLBACK_API_KEY: "",
          SERPER_API_KEY: "",
          BASED_URL: "",
          FALLBACK_BASED_URL: "",
        }));
      }
      if (settingsData.env) {
        setEnvValues(settingsData.env);
      }
      if (typeof settingsData.fileSystemPrompt === "string") {
        setFileSystemPrompt(settingsData.fileSystemPrompt);
      }
      if (typeof settingsData.fileInitialPrompt === "string") {
        setFileInitialPrompt(settingsData.fileInitialPrompt);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to load data" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Require both the auth flag and a session-scoped key. If the key is
    // missing (e.g. restored localStorage flag after a tab restart), clear the
    // flag and force a fresh login.
    if (isAdminAuthenticated() && getAdminKey()) {
      setAuthenticated(true);
    } else {
      setAdminAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) return;

    void loadData();
  }, [authenticated, loadData]);

  const handleLogin = async () => {
    setLoginError("");
    try {
      const response = await fetch("/api/admin/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: loginKey }),
      });

      if (response.ok) {
        setAdminKey(loginKey);
        setAdminAuthenticated(true);
        setAuthenticated(true);
      } else {
        setLoginError("Invalid key");
      }
    } catch {
      setLoginError("Failed to verify key. Please try again.");
    }
  };

  const handleLogout = () => {
    logoutAdmin();
    setAuthenticated(false);
  };

  const validateSettings = (): string | null => {
    const urlFields = [
      { label: "Primary endpoint", value: settings.BASED_URL },
      { label: "Fallback endpoint", value: settings.FALLBACK_BASED_URL },
    ];

    for (const field of urlFields) {
      if (field.value && field.value.trim().length > 0) {
        try {
          new URL(field.value.trim());
        } catch {
          return `${field.label} must be a valid URL.`;
        }
      }
    }

    const modelMaps = [settings.PRIMARY_MODELS, settings.FALLBACK_MODELS];
    for (const map of modelMaps) {
      if (!map) continue;
      for (const [key, value] of Object.entries(map)) {
        if (typeof value !== "string") {
          return `Model mapping for ${key} must be a string.`;
        }
      }
    }

    return null;
  };

  const handleSaveGlobalSettings = async () => {
    const validationError = validateSettings();
    if (validationError) {
      setMessage({ type: "error", text: validationError });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/global-settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          ...settings,
          PRIMARY_MODELS: settings.PRIMARY_MODELS,
          FALLBACK_MODELS: settings.FALLBACK_MODELS,
          label: changeReason,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Global settings updated successfully!" });
        setChangeReason("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: `Failed to update settings: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleSetCurrentCodeTokens = () => {
    setNewBlockrunApiKey(currentSettingsValues.BLOCKRUN_API_KEY);
    setNewFallbackApiKey(currentSettingsValues.FALLBACK_API_KEY);
    setNewSerper(currentSettingsValues.SERPER_API_KEY);
    setNewBaseUrl(currentSettingsValues.BASED_URL);
    setNewFallbackBaseUrl(currentSettingsValues.FALLBACK_BASED_URL);
  };

  const effectivePrimaryBaseURL = settings.useFallbackAsPrimary
    ? settings.FALLBACK_BASED_URL ?? ""
    : settings.BASED_URL ?? "";
  const effectiveFallbackBaseURL = settings.useFallbackAsPrimary
    ? settings.BASED_URL ?? ""
    : settings.FALLBACK_BASED_URL ?? "";
  const effectiveBlockrunApiKey = settings.useFallbackAsPrimary
    ? settings.FALLBACK_API_KEY ?? ""
    : settings.BLOCKRUN_API_KEY ?? "";
  const effectiveFallbackApiKey = settings.useFallbackAsPrimary
    ? settings.BLOCKRUN_API_KEY ?? ""
    : settings.FALLBACK_API_KEY ?? "";

  const isUsingFileFallback = !settings.SYSTEM_PROMPT || settings.SYSTEM_PROMPT.trim().length === 0;

  const handleSetCurrentEditTokens = () => {
    if (!editTokens) return;
    setEditTokens({
      BLOCKRUN_API_KEY: currentSettingsValues.BLOCKRUN_API_KEY || editTokens.BLOCKRUN_API_KEY,
      FALLBACK_API_KEY: currentSettingsValues.FALLBACK_API_KEY || editTokens.FALLBACK_API_KEY,
      SERPER_API_KEY: currentSettingsValues.SERPER_API_KEY || editTokens.SERPER_API_KEY || "",
      BASED_URL: currentSettingsValues.BASED_URL || editTokens.BASED_URL,
      FALLBACK_BASED_URL: currentSettingsValues.FALLBACK_BASED_URL || editTokens.FALLBACK_BASED_URL,
    });
  };

  const handlePrimaryBaseURLChange = (value: string) => {
    setSettings((current) => {
      const next = current.useFallbackAsPrimary
        ? { ...current, FALLBACK_BASED_URL: value }
        : { ...current, BASED_URL: value };
      setCurrentEnvironmentInputs((currentInputs) => ({
        ...currentInputs,
        PRIMARY_ENDPOINT: value,
      }));
      return next;
    });
  };

  const handleFallbackBaseURLChange = (value: string) => {
    setSettings((current) => {
      const next = current.useFallbackAsPrimary
        ? { ...current, BASED_URL: value }
        : { ...current, FALLBACK_BASED_URL: value };
      setCurrentEnvironmentInputs((currentInputs) => ({
        ...currentInputs,
        FALLBACK_ENDPOINT: value,
      }));
      return next;
    });
  };

  const handlePrimaryApiKeyChange = (value: string) => {
    setSettings((current) => {
      const next = current.useFallbackAsPrimary
        ? { ...current, FALLBACK_API_KEY: value }
        : { ...current, BLOCKRUN_API_KEY: value };
      setCurrentEnvironmentInputs((currentInputs) => ({
        ...currentInputs,
        PRIMARY_KEY: value,
      }));
      return next;
    });
  };

  const handleFallbackApiKeyChange = (value: string) => {
    setSettings((current) => {
      const next = current.useFallbackAsPrimary
        ? { ...current, BLOCKRUN_API_KEY: value }
        : { ...current, FALLBACK_API_KEY: value };
      setCurrentEnvironmentInputs((currentInputs) => ({
        ...currentInputs,
        FALLBACK_KEY: value,
      }));
      return next;
    });
  };

  const handleSerperApiKeyChange = (value: string) => {
    setSettings((current) => ({ ...current, SERPER_API_KEY: value }));
    setCurrentEnvironmentInputs((currentInputs) => ({
      ...currentInputs,
      SERPER_API_KEY: value,
    }));
  };

  const handleAdminKeyChange = (value: string) => {
    setEnvValues((current) => ({ ...current, ADMIN_KEY: value }));
    setCurrentEnvironmentInputs((currentInputs) => ({
      ...currentInputs,
      ADMIN_KEY: value,
    }));
  };

  const MODEL_KEYS = ["instant", "expert", "websearch", "fileAnalysis", "coding"] as const;
  type ModelKey = (typeof MODEL_KEYS)[number];

  const effectivePrimaryModels = settings.useFallbackAsPrimary
    ? settings.FALLBACK_MODELS ?? FALLBACK_MODELS
    : settings.PRIMARY_MODELS ?? PRIMARY_MODELS;
  const effectiveFallbackModels = settings.useFallbackAsPrimary
    ? settings.PRIMARY_MODELS ?? PRIMARY_MODELS
    : settings.FALLBACK_MODELS ?? FALLBACK_MODELS;

  const currentSettingsValues = {
    ADMIN_KEY: envValues.ADMIN_KEY,
    SERPER_API_KEY: settings.SERPER_API_KEY || envValues.SERPER_API_KEY || "",
    BLOCKRUN_API_KEY: settings.useFallbackAsPrimary
      ? settings.FALLBACK_API_KEY || envValues.FALLBACK_API_KEY || ""
      : settings.BLOCKRUN_API_KEY || envValues.BLOCKRUN_API_KEY || "",
    FALLBACK_API_KEY: settings.useFallbackAsPrimary
      ? settings.BLOCKRUN_API_KEY || envValues.BLOCKRUN_API_KEY || ""
      : settings.FALLBACK_API_KEY || envValues.FALLBACK_API_KEY || "",
    BASED_URL: settings.useFallbackAsPrimary
      ? settings.FALLBACK_BASED_URL || envValues.FALLBACK_BASED_URL || ""
      : settings.BASED_URL || envValues.BASED_URL || "",
    FALLBACK_BASED_URL: settings.useFallbackAsPrimary
      ? settings.BASED_URL || envValues.BASED_URL || ""
      : settings.FALLBACK_BASED_URL || envValues.FALLBACK_BASED_URL || "",
  };

  const setEffectivePrimaryModel = (key: ModelKey, value: string) => {
    if (settings.useFallbackAsPrimary) {
      setSettings((current) => ({
        ...current,
        FALLBACK_MODELS: {
          ...(current.FALLBACK_MODELS ?? FALLBACK_MODELS),
          [key]: value,
        },
      }));
    } else {
      setSettings((current) => ({
        ...current,
        PRIMARY_MODELS: {
          ...(current.PRIMARY_MODELS ?? PRIMARY_MODELS),
          [key]: value,
        },
      }));
    }
  };

  const setEffectiveFallbackModel = (key: ModelKey, value: string) => {
    if (settings.useFallbackAsPrimary) {
      setSettings((current) => ({
        ...current,
        PRIMARY_MODELS: {
          ...(current.PRIMARY_MODELS ?? PRIMARY_MODELS),
          [key]: value,
        },
      }));
    } else {
      setSettings((current) => ({
        ...current,
        FALLBACK_MODELS: {
          ...(current.FALLBACK_MODELS ?? FALLBACK_MODELS),
          [key]: value,
        },
      }));
    }
  };

  const resetPrimaryModelsToDefault = () => {
    if (settings.useFallbackAsPrimary) {
      setSettings((current) => ({
        ...current,
        FALLBACK_MODELS: FALLBACK_MODELS,
      }));
    } else {
      setSettings((current) => ({
        ...current,
        PRIMARY_MODELS: PRIMARY_MODELS,
      }));
    }
  };

  const resetFallbackModelsToDefault = () => {
    if (settings.useFallbackAsPrimary) {
      setSettings((current) => ({
        ...current,
        PRIMARY_MODELS: PRIMARY_MODELS,
      }));
    } else {
      setSettings((current) => ({
        ...current,
        FALLBACK_MODELS: FALLBACK_MODELS,
      }));
    }
  };

  const handleAddCode = async () => {
    const durationHours = Number(newDurationHours);
    const maxRedemptions = Number(newMaxRedemptions);
    if (!newCode.trim() || !Number.isFinite(durationHours) || durationHours <= 0 || !Number.isInteger(maxRedemptions) || maxRedemptions <= 0) {
      setMessage({ type: "error", text: "Code, duration, and maximum redemptions are required" });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          code: newCode.trim(),
          durationMinutes: Math.round(durationHours * 60),
          maxRedemptions,
          tokens: {
            BLOCKRUN_API_KEY: newBlockrunApiKey,
            FALLBACK_API_KEY: newFallbackApiKey,
            SERPER_API_KEY: newSerper,
            BASED_URL: newBaseUrl,
            FALLBACK_BASED_URL: newFallbackBaseUrl,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Code created successfully!" });
        setCodes((currentCodes) => [...currentCodes, data.code]);
        setNewCode("");
        setNewDurationHours("24");
        setNewMaxRedemptions("1");
        setNewBlockrunApiKey("");
        setNewFallbackApiKey("");
        setNewSerper("");
        setNewBaseUrl("");
        setNewFallbackBaseUrl("");
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
          ...adminHeaders(),
        },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Code deleted" });
        setCodes((currentCodes) => currentCodes.filter((item) => item.code !== code));
      } else {
        setMessage({ type: "error", text: data.error || "Failed to delete code" });
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
          ...adminHeaders(),
        },
        body: JSON.stringify({
          code,
          redeemed: false,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: `Code "${code}" has been reset!` });
        setCodes((currentCodes) => currentCodes.map((item) => (
          item.code === code ? data.code : item
        )));
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
    const durationHours = Number(editDurationHours);
    const maxRedemptions = Number(editMaxRedemptions);
    if (!editTokens || !Number.isFinite(durationHours) || durationHours <= 0 || !Number.isInteger(maxRedemptions) || maxRedemptions <= 0) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...adminHeaders(),
        },
        body: JSON.stringify({
          code,
          durationMinutes: Math.round(durationHours * 60),
          maxRedemptions,
          ...(editExpiry ? { expiresAt: new Date(editExpiry).toISOString() } : {}),
          tokens: editTokens,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: "Code updated!" });
        setCodes((currentCodes) => currentCodes.map((item) => (
          item.code === code ? data.code : item
        )));
        setEditingCode(null);
        setEditTokens(null);
        setEditExpiry("");
        setEditDurationHours("");
        setEditMaxRedemptions("");
      } else {
        setMessage({ type: "error", text: data.error || "Failed to update code" });
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
      {/* Expanded modal - rendered at page root level for true full-screen coverage */}
      {expandScreen && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-[#0d0d11]"
          style={{ position: "fixed" }}
          onClick={() => setExpandScreen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="System Prompt Expanded Editor"
        >
          <div
            className="relative flex h-screen flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-white">System Prompt — Expanded Editor</p>
                <span className={cn(
                  "rounded-md border px-2 py-0.5 text-[10px] font-semibold",
                  isUsingFileFallback ? "border-white/10 bg-white/5 text-[#8c8f9c]" : "border-amber-500/20 bg-amber-500/10 text-amber-400"
                )}>
                  {isUsingFileFallback ? "Using systemprompt.txt" : "Custom override"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setExpandScreen(false)}
                className="rounded-full bg-white/5 p-2 text-[#8c8f9c] transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close expanded editor"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Toolbar: Find/Replace, Go to Line, Options */}
            <div className="space-y-3 border-b border-white/10 px-5 py-3 flex-shrink-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex flex-1 gap-2">
                  <label className="mb-1 block text-[10px] font-medium text-[#8c8f9c]">Find <span className="text-[9px] text-[#5e616e]">(Ctrl+F)</span></label>
                  <input
                    type="text"
                    value={findText}
                    onChange={(e) => setFindText(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 font-mono text-xs text-white placeholder-[#5e616e] focus:border-white/20 focus:outline-none"
                    placeholder="Text to find"
                  />
                </div>
                <div className="flex flex-1 gap-2">
                  <label className="mb-1 block text-[10px] font-medium text-[#8c8f9c]">Replace <span className="text-[9px] text-[#5e616e]">(Ctrl+H)</span></label>
                  <input
                    type="text"
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    className="flex-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 font-mono text-xs text-white placeholder-[#5e616e] focus:border-white/20 focus:outline-none"
                    placeholder="Replacement text"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (!findText) return;
                    const current = settings.SYSTEM_PROMPT ?? "";
                    setSettings((s) => ({ ...s, SYSTEM_PROMPT: current.split(findText).join(replaceText) }));
                  }}
                  disabled={!findText}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-semibold text-white transition-all active:scale-95 hover:bg-white/15 disabled:opacity-50"
                >
                  Replace All
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => goToMatch(matchIndex - 1)}
                    disabled={!findText}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                    aria-label="Previous match"
                  >
                    Previous
                  </button>
                  <span className="text-[10px] text-[#6d7288]">
                    {findText
                      ? `match ${findMatches.length ? matchIndex + 1 : 0} of ${findMatches.length}`
                      : "Enter text to find"}
                  </span>
                  <button
                    type="button"
                    onClick={() => goToMatch(matchIndex + 1)}
                    disabled={!findText}
                    className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                    aria-label="Next match"
                  >
                    Next
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 p-1 rounded-lg bg-white/5 border border-white/5">
                  <label className="text-[10px] text-[#6d7288] mr-1">Go to line <span className="text-[9px]">(Ctrl+G)</span></label>
                  <input
                    type="number"
                    min="1"
                    value={goToLineValue}
                    onChange={(e) => setGoToLineValue(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleGoToLine()}
                    className="w-16 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-[10px] text-white placeholder-[#5e616e] focus:border-white/20 focus:outline-none"
                    placeholder="Line"
                  />
                  <button
                    type="button"
                    onClick={handleGoToLine}
                    className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[10px] font-medium text-white transition-colors"
                  >
                    Go
                  </button>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-[#6d7288] border-l border-white/10 pl-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showLineNumbers}
                      onChange={(e) => setShowLineNumbers(e.target.checked)}
                      className="rounded border-white/20 text-amber-400 w-3.5 h-3.5"
                    />
                    Line numbers
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={wrapLines}
                      onChange={(e) => setWrapLines(e.target.checked)}
                      className="rounded border-white/20 text-amber-400 w-3.5 h-3.5"
                    />
                    Word wrap
                  </label>
                </div>
              </div>
            </div>

            {/* Editor with line numbers, highlight overlay */}
            <div className="relative flex-1 overflow-hidden min-h-0">
              {/* Line numbers gutter */}
              {showLineNumbers && (
                <div
                  ref={lineNumbersRef}
                  className="absolute left-0 top-0 bottom-0 w-10 bg-[#0a0a0c]/80 border-r border-white/5 flex flex-col overflow-hidden pointer-events-none z-10"
                >
                  {generateLineNumbers(settings.SYSTEM_PROMPT ?? "", getActiveLineNumber())}
                </div>
              )}
              <div
                ref={backdropRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-4 font-mono text-sm leading-relaxed text-transparent"
              >
                <HighlightedText text={settings.SYSTEM_PROMPT ?? ""} find={findText} activeIndex={matchIndex} />
              </div>
              <textarea
                ref={expandedTextareaRef}
                value={settings.SYSTEM_PROMPT ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, SYSTEM_PROMPT: e.target.value }))}
                onScroll={syncBackdropScroll}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                className="absolute inset-0 h-full w-full resize-none whitespace-pre-wrap break-words border-0 bg-transparent p-4 font-mono text-sm leading-relaxed text-white caret-white outline-none placeholder-[#5e616e] focus:outline-none"
                style={{ 
                  paddingLeft: showLineNumbers ? "44px" : "16px",
                  whiteSpace: wrapLines ? "pre-wrap" : "pre" 
                }}
                placeholder="Enter the system prompt…"
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3 flex-shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, SYSTEM_PROMPT: fileSystemPrompt }))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                >
                  Reset to file default
                </button>
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, SYSTEM_PROMPT: "" }))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                >
                  Clear (use bundled file)
                </button>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-[#6d7288]">{(settings.SYSTEM_PROMPT ?? "").length} chars</span>
                <button
                  type="button"
                  onClick={handleSaveGlobalSettings}
                  className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black transition-all active:scale-95 hover:bg-white/90"
                >
                  Save System Prompt
                </button>
                <button
                  type="button"
                  onClick={() => setExpandScreen(false)}
                  className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 hover:bg-white/15"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
          <div className="flex flex-wrap items-center gap-2.5 mb-4">
            <div className="p-1.5 rounded-lg bg-white/5 border border-white/10">
              <Key className="w-4 h-4 text-[#8c8f9c]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Global Server Settings</h2>
              <p className="text-[10px] text-[#8c8f9c]">Edit the active runtime configuration values and audit previous changes.</p>
            </div>
            <Link
              href="/gihreheiedjvdkvhdkjpp1/history"
              className="ml-auto text-[10px] font-semibold text-amber-400 bg-amber-500/10 px-3 py-1.5 rounded-full hover:bg-amber-500/15 transition-colors"
            >
              History
            </Link>
          </div>
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5 space-y-6">
            {/* System Prompt (live, runtime-editable) */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandScreen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                    Expand Screen
                  </button>
                </div>
                <span className={cn(
                  "px-2 py-0.5 rounded-md text-[10px] font-semibold shrink-0",
                  isUsingFileFallback ? "bg-white/5 text-[#8c8f9c] border border-white/10" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                )}>
                  {isUsingFileFallback ? "Using systemprompt.txt" : "Custom override"}
                </span>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">System Prompt</p>
                <p className="text-[11px] text-[#6d7288]">Live runtime editor — changes apply on the next chat request. Clear the field to fall back to systemprompt.txt. Use Expand Screen for find &amp; replace and line jumps.</p>
              </div>

              <textarea
                value={settings.SYSTEM_PROMPT ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, SYSTEM_PROMPT: e.target.value }))}
                rows={10}
                spellCheck={false}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all resize-y leading-relaxed"
                placeholder="Enter the system prompt…"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, SYSTEM_PROMPT: fileSystemPrompt }))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                >
                  Reset to file default
                </button>
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, SYSTEM_PROMPT: "" }))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                >
                  Clear (use bundled file)
                </button>
                <span className="ml-auto text-[10px] text-[#6d7288]">{(settings.SYSTEM_PROMPT ?? "").length} chars</span>
              </div>
            </div>

            {/* Initial Chat Prompt (live, runtime-editable) */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 space-y-2.5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">Initial Chat Prompt</p>
                <p className="text-[11px] text-[#6d7288]">Appended to the system prompt on every message (or chat start). Live runtime editor — changes apply on the next chat request. Clear the field to fall back to the default.</p>
              </div>

              <textarea
                value={settings.INITIAL_CHAT_PROMPT ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, INITIAL_CHAT_PROMPT: e.target.value }))}
                rows={4}
                spellCheck={false}
                className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all resize-y leading-relaxed"
                placeholder="Enter the initial chat prompt…"
              />
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, INITIAL_CHAT_PROMPT: fileInitialPrompt }))}
                  disabled={!fileInitialPrompt}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Load from initial_prompt.txt
                </button>
                <button
                  type="button"
                  onClick={() => setSettings((s) => ({ ...s, INITIAL_CHAT_PROMPT: "" }))}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                >
                  Clear (use default)
                </button>
                <span className="ml-auto text-[10px] text-[#6d7288]">{(settings.INITIAL_CHAT_PROMPT ?? "").length} chars</span>
              </div>
            </div>

            {/* Apply Initial Prompt to Every Message Toggle */}
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-4 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">Apply Initial Prompt to Every Message</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(settings.applyInitialPromptToEveryMessage)}
                  onClick={() => setSettings((s) => ({ ...s, applyInitialPromptToEveryMessage: !s.applyInitialPromptToEveryMessage }))}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                    settings.applyInitialPromptToEveryMessage ? "bg-amber-500" : "bg-white/10"
                  )}
                  aria-label={settings.applyInitialPromptToEveryMessage ? "Enabled" : "Disabled"}
                >
                  <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", settings.applyInitialPromptToEveryMessage ? "translate-x-4" : "translate-x-0.5")} />
                </button>
              </div>
              <p className="text-[11px] text-[#6d7288]">
                {settings.applyInitialPromptToEveryMessage
                  ? "Initial prompt is prepended to the system prompt on every message."
                  : "Initial prompt is only prepended on chat start (first message)."}
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">Current Environment Values</p>
                    <p className="text-[11px] text-[#6d7288]">These values are used by the runtime when paid access is not active.</p>
                  </div>
                </div>

                {/* Toggle row: fallback primary */}
                <label className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3 cursor-pointer hover:bg-white/[0.05] transition-colors">
                  <div className="pr-3">
                    <span className="text-xs font-medium text-white">Make fallback endpoint primary</span>
                    <p className="text-[10px] text-[#6d7288] mt-0.5">Swap primary/fallback endpoints and model IDs.</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.useFallbackAsPrimary)}
                    onClick={() => {
                      const nextSettings = { ...settings, useFallbackAsPrimary: !settings.useFallbackAsPrimary };
                      setSettings(nextSettings);
                      setCurrentEnvironmentInputs(buildCurrentEnvironmentInputs(nextSettings, envValues));
                    }}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      Boolean(settings.useFallbackAsPrimary) ? "bg-amber-400" : "bg-white/10"
                    )}
                  >
                    <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", Boolean(settings.useFallbackAsPrimary) ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </label>

                {/* Toggle row: string-based chat history */}
                <label className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3 cursor-pointer hover:bg-white/[0.05] transition-colors">
                  <div className="pr-3">
                    <span className="text-xs font-medium text-white">String-based chat history</span>
                    <p className="text-[10px] text-[#6d7288] mt-0.5">Inject history as text (for web-cookie models that reject message arrays).</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.stringBasedChatHistory)}
                    onClick={() => {
                      const nextSettings = { ...settings, stringBasedChatHistory: !settings.stringBasedChatHistory };
                      setSettings(nextSettings);
                    }}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      Boolean(settings.stringBasedChatHistory) ? "bg-amber-400" : "bg-white/10"
                    )}
                  >
                    <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", Boolean(settings.stringBasedChatHistory) ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </label>

                {/* Toggle row: auto-detect web cookie models */}
                <label className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] border border-white/10 px-4 py-3 cursor-pointer hover:bg-white/[0.05] transition-colors">
                  <div className="pr-3">
                    <span className="text-xs font-medium text-white">Auto-detect web-cookie models</span>
                    <p className="text-[10px] text-[#6d7288] mt-0.5">Auto-apply string history when a model ID contains "web".</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(settings.autoDetectWebCookieModels)}
                    onClick={() => {
                      const nextSettings = { ...settings, autoDetectWebCookieModels: !settings.autoDetectWebCookieModels };
                      setSettings(nextSettings);
                    }}
                    className={cn(
                      "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                      Boolean(settings.autoDetectWebCookieModels) ? "bg-amber-400" : "bg-white/10"
                    )}
                  >
                    <span className={cn("inline-block h-4 w-4 transform rounded-full bg-white transition-transform", Boolean(settings.autoDetectWebCookieModels) ? "translate-x-4" : "translate-x-0.5")} />
                  </button>
                </label>

                <div className="grid gap-3">
                  <div>
                    <label className="block text-[10px] font-medium text-[#8c8f9c]">ADMIN_KEY</label>
                    <input
                      type="text"
                      value={currentEnvironmentInputs.ADMIN_KEY}
                      onChange={(e) => handleAdminKeyChange(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                      placeholder="Admin key (local display only)"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#8c8f9c]">SERPER_API_KEY</label>
                    <input
                      type="text"
                      value={currentEnvironmentInputs.SERPER_API_KEY}
                      onChange={(e) => handleSerperApiKeyChange(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                      placeholder="Global Serper API key"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#8c8f9c]">PRIMARY_KEY</label>
                    <input
                      type="text"
                      value={currentEnvironmentInputs.PRIMARY_KEY}
                      onChange={(e) => handlePrimaryApiKeyChange(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                      placeholder="Primary API key"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#8c8f9c]">FALLBACK_KEY</label>
                    <input
                      type="text"
                      value={currentEnvironmentInputs.FALLBACK_KEY}
                      onChange={(e) => handleFallbackApiKeyChange(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                      placeholder="Fallback API key"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#8c8f9c]">PRIMARY_ENDPOINT</label>
                    <input
                      type="text"
                      value={currentEnvironmentInputs.PRIMARY_ENDPOINT}
                      onChange={(e) => handlePrimaryBaseURLChange(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                      placeholder="Primary endpoint URL"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#8c8f9c]">FALLBACK_ENDPOINT</label>
                    <input
                      type="text"
                      value={currentEnvironmentInputs.FALLBACK_ENDPOINT}
                      onChange={(e) => handleFallbackBaseURLChange(e.target.value)}
                      className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                      placeholder="Fallback endpoint URL"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.18em] text-[#7a7e8a]">Model mappings</p>
                    <p className="text-[11px] text-[#6d7288]">Configure primary and fallback model IDs used by the provider layer.</p>
                  </div>
                  <button
                    type="button"
                    onClick={resetPrimaryModelsToDefault}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                  >
                    Reset primary defaults
                  </button>
                </div>
                <div className="space-y-2">
                  {MODEL_KEYS.map((key) => (
                    <div key={key} className="grid gap-1">
                      <label className="text-[10px] font-medium text-[#8c8f9c]">Primary model for {key}</label>
                      <input
                        type="text"
                        value={effectivePrimaryModels[key] ?? ""}
                        onChange={(e) => setEffectivePrimaryModel(key, e.target.value)}
                        className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                        placeholder={`Primary model for ${key}`}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-3 pt-4 border-t border-white/10">
                  <p className="text-[10px] font-medium text-[#8c8f9c]">Fallback model mappings</p>
                  <button
                    type="button"
                    onClick={resetFallbackModelsToDefault}
                    className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                  >
                    Reset fallback defaults
                  </button>
                </div>
                <div className="space-y-2">
                  {MODEL_KEYS.map((key) => (
                    <div key={key} className="grid gap-1">
                      <label className="text-[10px] font-medium text-[#8c8f9c]">Fallback model for {key}</label>
                      <input
                        type="text"
                        value={effectiveFallbackModels[key] ?? ""}
                        onChange={(e) => setEffectiveFallbackModel(key, e.target.value)}
                        className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                        placeholder={`Fallback model for ${key}`}
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">Change reason</label>
                  <input
                    type="text"
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    placeholder="Brief description for history"
                    className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-white/20 transition-all"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[10px] text-[#6d7288]">Saving will update the current active configuration and record the previous state in history.</p>
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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">Code</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCode}
                    onChange={(e) => setNewCode(e.target.value)}
                    className="flex-1 bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                    placeholder="e.g. NOVA-PREMIUM-2025"
                  />
                  <button
                    type="button"
                    onClick={() => setNewCode(generateRandomCode())}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-[10px] font-medium text-[#8c8f9c] hover:text-white hover:bg-white/10 border border-white/10 rounded-xl transition-colors whitespace-nowrap"
                    title="Generate random code: NOVA-{duration}-{3letters}{3numbers}"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Generate
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">Access Duration (Hours)</label>
                <input
                  type="number"
                  min="0.02"
                  step="0.01"
                  value={newDurationHours}
                  onChange={(e) => setNewDurationHours(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-white/20 transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">Maximum Redemptions</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={newMaxRedemptions}
                  onChange={(e) => setNewMaxRedemptions(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white focus:outline-none focus:border-white/20 transition-all"
                />
              </div>
            </div>
            <div className="space-y-3 mb-3">
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">BLOCKRUN_API_KEY (for this code)</label>
                <input
                  type="text"
                  value={newBlockrunApiKey}
                  onChange={(e) => setNewBlockrunApiKey(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter primary API key for this code..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">FALLBACK_API_KEY (for this code)</label>
                <input
                  type="text"
                  value={newFallbackApiKey}
                  onChange={(e) => setNewFallbackApiKey(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter fallback API key for this code..."
                />
              </div>
              <button
                type="button"
                onClick={handleSetCurrentCodeTokens}
                disabled={loading}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Use current global key values
              </button>
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
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">BASED_URL (for this code)</label>
                <input
                  type="text"
                  value={newBaseUrl}
                  onChange={(e) => setNewBaseUrl(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter primary endpoint URL for this code..."
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-[#8c8f9c] mb-1">FALLBACK_BASED_URL (for this code)</label>
                <input
                  type="text"
                  value={newFallbackBaseUrl}
                  onChange={(e) => setNewFallbackBaseUrl(e.target.value)}
                  className="w-full bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-white font-mono placeholder-[#5e616e] focus:outline-none focus:border-white/20 transition-all"
                  placeholder="Enter fallback endpoint URL for this code..."
                />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleAddCode}
                disabled={loading || !newCode.trim() || Number(newDurationHours) <= 0 || Number(newMaxRedemptions) < 1}
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
                const redemptionCount = code.redemptionCount ?? code.redeemedUserIds?.length ?? Number(code.redeemed);
                const maxRedemptions = code.maxRedemptions ?? 1;
                const hasStarted = Boolean(code.activatedAt);
                const isExpired = Boolean(code.expiresAt && new Date(code.expiresAt) <= new Date());
                const isAtCapacity = redemptionCount >= maxRedemptions;
                return (
                  <div
                    key={code.code}
                    className={cn(
                      "rounded-2xl border p-4 transition-colors",
                      isExpired
                        ? "bg-rose-500/5 border-rose-500/20"
                        : redemptionCount > 0
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : "bg-white/[0.03] border-white/10"
                    )}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-sm font-mono font-semibold text-white">{code.code}</span>
                        {isExpired ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                            Expired
                          </span>
                        ) : isAtCapacity ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Fully Redeemed
                          </span>
                        ) : redemptionCount > 0 ? (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                            Ready
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
                      {hasStarted && code.expiresAt
                        ? `Expires: ${new Date(code.expiresAt).toLocaleString()}`
                        : `Duration: ${(code.durationMinutes ?? 0) / 60} hours`}
                    </div>
                    <div className="text-[11px] text-[#8c8f9c] mb-2">
                      Redemptions: {redemptionCount} / {maxRedemptions}
                    </div>

                    {/* Edit code button */}
                    {editingCode === code.code ? (
                      <div className="space-y-2 mt-2 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">Access Duration (Hours)</label>
                          <input
                            type="number"
                            min="0.02"
                            step="0.01"
                            value={editDurationHours}
                            onChange={(e) => setEditDurationHours(e.target.value)}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">Maximum Redemptions</label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={editMaxRedemptions}
                            onChange={(e) => setEditMaxRedemptions(e.target.value)}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        {hasStarted && (
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">Expiry Date</label>
                          <input
                            type="datetime-local"
                            value={editExpiry}
                            onChange={(e) => setEditExpiry(e.target.value)}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        )}
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">BLOCKRUN_API_KEY</label>
                          <input
                            type="text"
                            value={editTokens?.BLOCKRUN_API_KEY || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, BLOCKRUN_API_KEY: e.target.value })}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">FALLBACK_API_KEY</label>
                          <input
                            type="text"
                            value={editTokens?.FALLBACK_API_KEY || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, FALLBACK_API_KEY: e.target.value })}
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
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">BASED_URL</label>
                          <input
                            type="text"
                            value={editTokens?.BASED_URL || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, BASED_URL: e.target.value })}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-medium text-[#8c8f9c] mb-0.5">FALLBACK_BASED_URL</label>
                          <input
                            type="text"
                            value={editTokens?.FALLBACK_BASED_URL || ""}
                            onChange={(e) => setEditTokens({ ...editTokens!, FALLBACK_BASED_URL: e.target.value })}
                            className="w-full bg-white/[0.05] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-white/20 transition-all"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleSetCurrentEditTokens}
                          className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-medium text-white transition-colors"
                        >
                          Set the current one from global settings
                        </button>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => { setEditingCode(null); setEditTokens(null); setEditExpiry(""); setEditDurationHours(""); setEditMaxRedemptions(""); }}
                            className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-[#ccc] hover:bg-white/10 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditCode(code.code)}
                            disabled={loading || Number(editDurationHours) <= 0 || Number(editMaxRedemptions) < redemptionCount}
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
                          setEditExpiry(code.expiresAt ? toDateTimeLocalValue(code.expiresAt) : "");
                          setEditDurationHours(String((code.durationMinutes ?? 0) / 60));
                          setEditMaxRedemptions(String(maxRedemptions));
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
