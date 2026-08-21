"use client";

import { useRef, useEffect, useState, useCallback, useMemo, type TouchEvent, type WheelEvent } from "react";
import { useIsMobile } from "@/lib/use-is-mobile";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Zap, Shield, Code2 } from "lucide-react";
import { ChatInput, PendingAttachment } from "./chat-input";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { MessageNavigator, NavItem } from "@/app/message-navigator";
import { cn } from "@/lib/utils";
import { loadMessages, saveMessages, ModelParams, ChatFile, loadChatFiles } from "@/lib/storage";
import { isPaidOnlyModel } from "@/lib/llm-providers";
import { openPaidTierDialog } from "@/lib/paid-tier";

import { backupNow, flushBackup, restoreFromServer } from "@/lib/history-backup";
import { getSupportedAttachmentMimeType, isImageMimeType, normalizeDataUrl, validateFileSize, validateAttachmentBatch, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";
import { getPaidTierClientId, getPaidTierData, getServerMode } from "@/lib/paid-tier";

type Model = "instant" | "expert" | "coding";

const MESSAGE_LIMIT = 200;
const RECENT_MESSAGES_TO_KEEP = 180;
const SCROLL_BOTTOM_THRESHOLD = 24;



// Retry policy for transient provider failures ("capacity busy" etc.).
// The server already retries internally (MODEL_MAX_RETRIES), but if a whole
// request still fails the client re-sends it up to MAX_RETRY_ATTEMPTS times.
// After the first RETRY_COOLDOWN_AFTER_ATTEMPT attempts, wait
// RETRY_COOLDOWN_MS before trying again so a busy provider has time to recover.
const MAX_RETRY_ATTEMPTS = 10;
const RETRY_COOLDOWN_AFTER_ATTEMPT = 3;
const RETRY_COOLDOWN_MS = 3000;

type Props = {
  chatId: string;
  model: Model;
  modelSettings?: ModelParams;
  onModelChange: (m: Model) => void;
  onFirstMessage: (title: string) => void;
  /** Whether this chat is the one currently displayed. Inactive chats stay
   *  mounted (hidden) so their assistant generations keep running in the
   *  background; this flag lets the view restore scroll position when it
   *  becomes visible again. */
  isActive?: boolean;
  /** Whether the sidebar (history) is open — hides the floating model selector
   *  so it does not visually conflict with the open sidebar, matching the
   *  sidebar opener's behavior. */
  sidebarOpen?: boolean;
};

const MODEL_TABS: { id: Model; label: string; icon: React.ReactNode }[] = [
  { id: "instant", label: "Instant", icon: <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> },
  { id: "expert", label: "Expert", icon: <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> },
  { id: "coding", label: "Coding", icon: <Code2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> },
];

function generateAttachmentId() {
  return Math.random().toString(36).slice(2, 10);
}

function fileToDataUrl(file: File, normalizedMimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(normalizeDataUrl(dataUrl, normalizedMimeType));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isProgressOnlyAssistantMessage(message: { role: string; parts: Array<{ type: string }> }) {
  return (
    message.role === "assistant" &&
    message.parts.some(
      (part) =>
        part.type === "data-search" ||
        part.type === "data-thought" ||
        part.type === "data-file"
    ) &&
    !message.parts.some((part) => part.type === "text")
  );
}

function getCurrentResponseProgressStatus(
  messages: UIMessage[],
  partType: "data-search" | "data-thought" | "data-file"
): string | undefined {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  for (let messageIndex = messages.length - 1; messageIndex > lastUserIndex; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== "assistant") continue;

    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
      const part = message.parts[partIndex];
      if (part.type !== partType) continue;
      const status = (part as { data?: { status?: unknown } }).data?.status;
      return typeof status === "string" ? status : undefined;
    }
  }

  return undefined;
}

// A preprocessing phase (search / DeepThink / file scan) only needs to
// suppress the generic typing dots while it's ACTIVELY showing its own
// indicator. `status === undefined` means that phase never started for this
// turn (e.g. web search was enabled but the model chose not to call the
// tool) — that must NOT be treated the same as "still in progress", or the
// dots never get permission to show at all.
function isPreprocessingActive(status: string | undefined) {
  return status !== undefined && status !== "done" && status !== "error";
}

function createConversationSummary(text: string) {
  return {
    id: `conversation-summary-${Date.now()}`,
    role: "system" as const,
    parts: [{
      type: "text" as const,
      text: `Private summary of the earlier conversation. Use it as context and do not mention it to the user:\n${text}`,
    }],
  };
}

// --- Edit-message version branching -----------------------------------
// When a user edits a message, we keep the original (and every prior edit)
// around as a "branch" instead of discarding it, so the message can show a
// "< 2 / 3 >" switcher like ChatGPT/Claude's own edit UI.
//
// Branch model (tree structure):
//   Each message that has been edited/regenerated gets its own BranchGroup,
//   keyed by that message's ID. A BranchGroup contains branches that start
//   from that specific message:
//     - For a USER message edit: branches = [edited user msg, assistant reply, ...downstream]
//     - For an ASSISTANT message regenerate: branches = [regenerated assistant msg, ...downstream]
//
//   The conversation is a tree. Each branch knows its parent message ID.
//   When rendering, we follow the active branch from the root down,
//   switching at each branch point to the active version.
//
//   BranchGroup structure:
//     { branches: MessageBranch[], activeIndex: number, parentMessageId: string | null }
//   MessageBranch structure:
//     { messages: UIMessage[], childBranchIds: string[] }  // childBranchIds maps child message index -> branch group id
  type MessageBranch = { messages: UIMessage[]; childBranchIds: string[] };
  type BranchGroup = { branches: MessageBranch[]; activeIndex: number; parentMessageId: string | null };

function branchStorageKey(chatId: string) {
  return `nova-edit-branches:${chatId}`;
}

function loadBranchGroups(chatId: string): Record<string, BranchGroup> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(branchStorageKey(chatId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BranchGroup>;
    // Migration: ensure childBranchIds exists on all branches
    for (const group of Object.values(parsed)) {
      for (const branch of group.branches) {
        if (!branch.childBranchIds) {
          branch.childBranchIds = [];
        }
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

// Only groups that actually have MORE THAN ONE version are worth persisting:
// a single-version group renders no "< n/m >" switcher, so it is pure storage
// overhead. Filtering them out keeps this blob proportional to the number of
// edits/regenerations rather than to the length of the conversation.
function prunableBranchGroups(
  groups: Record<string, BranchGroup>
): Record<string, BranchGroup> {
  const out: Record<string, BranchGroup> = {};
  for (const [groupId, group] of Object.entries(groups)) {
    if (group?.branches?.length > 1) out[groupId] = group;
  }
  return out;
}

function saveBranchGroups(chatId: string, groups: Record<string, BranchGroup>) {
  if (typeof window === "undefined") return;
  const persistable = prunableBranchGroups(groups);
  try {
    if (Object.keys(persistable).length === 0) {
      window.localStorage.removeItem(branchStorageKey(chatId));
      return;
    }
    window.localStorage.setItem(branchStorageKey(chatId), JSON.stringify(persistable));
  } catch {
    // Storage unavailable or quota exhausted. Version snapshots are the
    // LOWEST-priority data we hold, so drop this blob entirely rather than
    // let it compete with the actual conversation for space.
    try {
      window.localStorage.removeItem(branchStorageKey(chatId));
    } catch {
      // nothing more we can do
    }
  }
}

export function ChatView({ chatId, model, modelSettings, onModelChange, onFirstMessage, isActive = true, sidebarOpen = false }: Props) {
  const isMobile = useIsMobile();

  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldFollowMessagesRef = useRef(true);
  const lastMessageScrollTopRef = useRef(0);
  const messageTouchStartYRef = useRef<number | null>(null);
  const wasLoadingRef = useRef(false);
  const notifiedRef = useRef(false);
  const summarizingHistoryRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesRef = useRef<UIMessage[]>([]);
  const [activeNavId, setActiveNavId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [deepThink, setDeepThink] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [requestFeatures, setRequestFeatures] = useState({ deepThink: false, webSearch: false });

  // Per-model default thinking effort (used when DeepThink is on)
  const thinkEffort = modelSettings?.thinkEffort ?? "low";
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [existingFiles, setExistingFiles] = useState<ChatFile[]>([]);
  const [freeTierStatus, setFreeTierStatus] = useState<{
    count: number;
    remaining: number;
    blocked: boolean;
    blockedUntil?: string;
  } | null>(null);
  const [showFreeTierUsage, setShowFreeTierUsage] = useState(false);
  const attachmentsRef = useRef<PendingAttachment[]>(attachments);
  // When regenerating an assistant message, track which one is being regenerated
  // so that when the new response arrives, we can create a branch with the old
  // response as version 1 and the new one as version 2.
  const regeneratingAssistantIdRef = useRef<string | null>(null);

  const initialMessages = useRef(loadMessages(chatId)).current;

  // If this chat has no local history but the server backup does (WebView
  // evicted localStorage), restore it before the conversation is rendered.
  useEffect(() => {
    if (initialMessages.length > 0) return;
    let cancelled = false;
    void restoreFromServer().then((restored) => {
      if (cancelled || !restored) return;
      const remoteMessages = restored.messages?.[chatId];
      if (!Array.isArray(remoteMessages) || remoteMessages.length === 0) return;
      // This request is async: the user may have started (or finished) a real
      // conversation while it was in flight. Overwriting that with the older
      // server snapshot would wipe the reply they just received, so only apply
      // the restore while the chat is still genuinely empty.
      if (messagesRef.current.length > 0) return;
      saveMessages(chatId, remoteMessages);
      setMessages(remoteMessages as never);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);
  // Message ids that should render flat, without the slide/fade entrance
  // animation: history loaded on mount, plus anything swapped into view by
  // editing a message or navigating between its versions. handleEditMessage
  // and handleBranchNav both add their ids here before calling setMessages,
  // so only a genuinely new send or freshly streamed reply is missing from
  // this set and gets the "new message" animation.
  const noAnimateIdsRef = useRef(new Set(initialMessages.map((m: any) => m.id))).current;

  const initialBranchGroups = useRef(loadBranchGroups(chatId)).current;
  const [branchGroups, setBranchGroups] = useState<Record<string, BranchGroup>>(initialBranchGroups);
  // Maps a message id -> the branch group id that governs versions of this message.
  // For a user message that was edited, this maps the original user message id -> its branch group.
  // For an assistant message that was regenerated, this maps the assistant message id -> its branch group.
  // Also maps version ids (e.g., "msgId::v2") to their branch group.
  const branchGroupForMessageRef = useRef<Record<string, string>>(
    (() => {
      const map: Record<string, string> = {};
      for (const [groupId, group] of Object.entries(initialBranchGroups)) {
        for (const branch of group.branches) {
          const headId = branch.messages[0]?.id;
          if (headId) map[headId] = groupId;
        }
      }
      return map;
    })()
  );

  useEffect(() => {
    setExistingFiles(loadChatFiles(chatId));
  }, [chatId]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Expert mode requires DeepThink, so the toggle is locked on. The effect
  // keeps DeepThink in sync with the model: on for "expert", unchanged for
  // other models. The chat input disables the toggle while Expert is active.
  useEffect(() => {
    setDeepThink((current) => (model === "expert" ? true : current));
  }, [model]);

  // Object URLs created for locally-picked files (see handleAddFiles) must be
  // revoked or they leak memory for the lifetime of the tab. Attachments are
  // revoked individually on removal/submit; this is the safety net for
  // whatever is still pending if the chat view unmounts (e.g. switching chats).
  useEffect(() => {
    return () => {
      for (const attachment of attachmentsRef.current) {
        if (attachment.source === "file") URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  // Web search cannot run together with file attachments — force it off
  // whenever files are attached.
  useEffect(() => {
    if (attachments.length > 0 && webSearch) {
      setWebSearch(false);
    }
  }, [attachments.length, webSearch]);

  const fetchTransport = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (!response.ok) {
      let message = "Something went wrong while contacting the AI service.";
      try {
        const text = await response.text();
        if (text) {
          const payload = JSON.parse(text);
          if (typeof payload?.error === "string") {
            message = payload.error;
          }
        }
      } catch {
        // fall back to the default message
      }
      throw new Error(message);
    }
    return response;
  }, []);

  const bodyTransport = useCallback(() => {
    const paidData = getPaidTierData();
    const serverMode = getServerMode();
    const hasActivePaidTier =
      serverMode === "paid" &&
      paidData &&
      new Date(paidData.expiresAt) > new Date();
    const paidTierCode = hasActivePaidTier ? paidData.code : null;
    const paidTierClientId = hasActivePaidTier ? getPaidTierClientId() : null;
    const clientId = getPaidTierClientId();
    const currentDate = new Date();
    const browserDate = `${String(currentDate.getMonth() + 1).padStart(2, "0")}/${String(currentDate.getDate()).padStart(2, "0")}/${currentDate.getFullYear()}`;
    const browserTime = `${String(currentDate.getHours()).padStart(2, "0")}:${String(currentDate.getMinutes()).padStart(2, "0")}`;
    return {
      model,
      deepThink,
      webSearch,
      browserDate,
      browserTime,
      modelSettings,
      paidTierCode,
      paidTierClientId,
      clientId,
      chatId,
    };
  }, [model, deepThink, webSearch, modelSettings, chatId]);

  const clientId = getPaidTierClientId();
  // Gate paid-tier detection behind a mount flag: getPaidTierData() and
  // getServerMode() read localStorage, which is unavailable during SSR.
  // Without this the server render ("Free Tier"/no-paid) diverges from the
  // client's first render and React throws a hydration mismatch. Both the
  // server and first client render evaluate the SSR-safe default; after
  // mount the real value is computed.
  const [chatMounted, setChatMounted] = useState(false);
  useEffect(() => setChatMounted(true), []);
  const hasPaidAccess = chatMounted && (() => {
    const paidData = getPaidTierData();
    const serverMode = getServerMode();
    return (
      serverMode === "paid" &&
      Boolean(paidData) &&
      new Date(paidData!.expiresAt) > new Date()
    );
  })();
  // Always-current mirror of hasPaidAccess so async free-tier fetch callbacks
  // can refuse to apply results once the user is known to be paid.
  const hasPaidAccessRef = useRef(hasPaidAccess);
  hasPaidAccessRef.current = hasPaidAccess;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: fetchTransport,
        body: bodyTransport,
      }),
    [fetchTransport, bodyTransport]
  );

  const { messages, sendMessage, status, error, regenerate, setMessages, stop, clearError } = useChat({
    id: chatId,
    messages: initialMessages as never,
    transport,
    // The SDK pushes a fresh `messages` array on every stream tick.
    // Reduced throttle so streaming tail animations receive chars per-chunk.
    throttle: 30,
  });

  // Keep a live ref of the latest messages for the unload/hide flush handler.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // When the user manually stops a reply, any in-flight progress part
  // (thinking / searching / file-scan) never received a terminal status, so
  // settle it to "error" once so the UI doesn't spin forever. We also stamp a
  // `data-stopped` marker on that exact assistant message: it is a normal
  // message part, so it persists across refresh and through branch switching.
  // The red hint renders only on the message carrying this marker.
  const settledStoppedRef = useRef(false);
  useEffect(() => {
    if (status !== "ready" || !stoppedMidGenerationRef.current || settledStoppedRef.current) return;
    settledStoppedRef.current = true;
    let changed = false;
    const next = messages.map((m) => {
      if (m.role !== "assistant") return m;
      const parts = (m.parts as any[]).map((part) => {
        if (part.type === "data-thought" && part.data?.status === "thinking") {
          changed = true;
          return { ...part, data: { ...part.data, status: "error" } };
        }
        if (part.type === "data-search" && part.data?.status === "searching") {
          changed = true;
          return { ...part, data: { ...part.data, status: "error" } };
        }
        if (part.type === "data-file" && part.data?.status === "reading") {
          changed = true;
          return { ...part, data: { ...part.data, status: "error" } };
        }
        return part;
      });
      // Only the last assistant message could have been the one we stopped.
      const isLastAssistant = m.id === lastAssistantIdForStopRef.current;
      if (isLastAssistant && !m.parts.some((p: any) => p.type === "data-stopped")) {
        changed = true;
        return { ...m, parts: [...parts, { type: "data-stopped" }] };
      }
      return changed ? { ...m, parts } : m;
    });
    if (changed) setMessages(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, messages, setMessages]);

  // Retry controller refs and helpers
  // `lastOutgoingRef` describes the CURRENT in-flight request. The retry
  // watchdog only auto-retries requests that were issued for a user message
  // that was just EDITED (`retryable: true` + the edited version id). Every
  // request carries its own eligibility, so a stale flag can never leak from
  // one request into the next (e.g. a plain assistant regeneration never
  // inherits retry behavior from an earlier edit).
  type OutgoingRequest = {
    type: "send" | "regenerate";
    payload: any;
    retryable: boolean;
    editedMessageId?: string;
    // For edit flow: use sendMessage (re-send last user message)
    // For regenerate flow: use regenerate with assistant messageId
    retryFn: "sendMessage" | "regenerate";
  };
  const lastOutgoingRef = useRef<null | OutgoingRequest>(null);
  const retryAttemptRef = useRef(0);
  const streamTimerRef = useRef<NodeJS.Timeout | null>(null);
  const firstTokenReceivedRef = useRef(false);
  const lastAssistantActivityKeyRef = useRef<string | null>(null);
  // Set when the user presses Stop. A manual stop means the last reply is
  // unfinished BY DEFINITION, so the red "You stopped the response" hint is
  // shown. Cleared whenever a new request (send, edit, regenerate) starts.
  const stoppedMidGenerationRef = useRef(false);
  // The id of the assistant message the user actually stopped, so the
  // `data-stopped` marker is stamped on the right message (and the hint never
  // leaks onto a finished branch sibling or a different message).
  const lastAssistantIdForStopRef = useRef<string | null>(null);
  // While true, transient errors are hidden from the UI because a retry is
  // already scheduled. Only the final failed attempt surfaces its error.
  const suppressingErrorRef = useRef(false);

  const clearStreamTimer = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
  }, []);

  const cleanupPartialAssistantMessages = useCallback(() => {
    setMessages((current) => {
      const lastUserIndex = (() => {
        for (let i = current.length - 1; i >= 0; i--) {
          if (current[i].role === "user") return i;
        }
        return -1;
      })();
      if (lastUserIndex === -1) return current;
      // Only discard assistant messages that are genuinely EMPTY. The watchdog
      // races with the stream: text can land between the timer firing and this
      // callback running, and unconditionally truncating here destroyed fully
      // received replies (leaving the chat as user-message-only). Anything that
      // already carries text is a real answer and must be kept.
      const tail = current.slice(lastUserIndex + 1);
      const hasRealContent = tail.some(
        (message) =>
          message.role === "assistant" &&
          message.parts.some(
            (part) => part.type === "text" && ((part as { text?: string }).text ?? "").length > 0
          )
      );
      if (hasRealContent) return current;
      return current.slice(0, lastUserIndex + 1);
    });
  }, [setMessages]);

  const handleFirstTokenSeen = useCallback(() => {
    firstTokenReceivedRef.current = true;
    retryAttemptRef.current = 0;
    suppressingErrorRef.current = false;
    clearStreamTimer();
  }, [clearStreamTimer]);

  // Monitor messages to detect first assistant activity arrival. This includes
  // search progress or other non-text assistant updates to avoid duplicate retries.
  useEffect(() => {
    const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant");
    if (!lastAssistantMessage) return;

    // Cheap O(1) activity fingerprint: message id + part count + total text
    // length + the tail of the last text part. The previous implementation
    // JSON.stringify'd every part on every chunk — with a long streaming
    // message that is O(n) work ~5x/sec and contributes to UI freezes.
    const lastTextPart = [...lastAssistantMessage.parts]
      .reverse()
      .find((part): part is { type: "text"; text: string } => part.type === "text");
    const tail =
      lastTextPart && lastTextPart.text.length > 0
        ? lastTextPart.text.slice(Math.max(0, lastTextPart.text.length - 64))
        : "";
    const activityKey = `${lastAssistantMessage.id}:${lastAssistantMessage.parts.length}:${lastTextPart?.text.length ?? 0}:${tail}`;

    if (activityKey !== lastAssistantActivityKeyRef.current) {
      lastAssistantActivityKeyRef.current = activityKey;
      handleFirstTokenSeen();
    }
  }, [messages, handleFirstTokenSeen]);

  const startAttempt = useCallback(async (attemptTimeout: number) => {
    const attempt = ++retryAttemptRef.current;
    console.info(`NOVA: starting stream attempt ${attempt}/${MAX_RETRY_ATTEMPTS}`);

    // schedule timeout to detect lack of tokens
    clearStreamTimer();
    firstTokenReceivedRef.current = false;
    streamTimerRef.current = setTimeout(() => {
      if (firstTokenReceivedRef.current) return;
      console.info(`NOVA: stream attempt ${attempt} timed out after ${attemptTimeout}ms - aborting and retrying`);
      try {
        stop();
      } catch (e) {
        // ignore
      }
      cleanupPartialAssistantMessages();
      // Only auto-retry requests that were issued for a user message that was
      // just EDITED. The edited version id is brand-new (the server has never
      // seen it), so re-issuing the exact same request is safe and idempotent.
      // Plain new sends and plain regenerations are never retryable, so the
      // retry never touches a user message the user didn't edit.
      const outgoing = lastOutgoingRef.current;
      const retryEligible = !!outgoing && outgoing.retryable && !!outgoing.editedMessageId;
      if (retryAttemptRef.current < MAX_RETRY_ATTEMPTS && outgoing && retryEligible) {
        suppressingErrorRef.current = true;
        // After the first few attempts, give the provider a breather before
        // the next try so a busy server has time to recover.
        const cooldown =
          retryAttemptRef.current >= RETRY_COOLDOWN_AFTER_ATTEMPT
            ? RETRY_COOLDOWN_MS
            : 50;
        // Next attempts use 10s
        const nextTimeout = 10000;
        const retryFn = outgoing.retryFn;
        setTimeout(() => {
          // Dismiss any error banner left over from the failed attempt before
          // re-sending, so transient failures never flash at the user.
          clearError();
          if (retryFn === "sendMessage") {
            // Edit flow: re-send the last user message (the edited version,
            // guaranteed to be last after cleanup) — no duplicate is appended.
            sendMessage();
          } else {
            // Assistant regeneration flow: regenerate the LAST message.
            // NEVER pass a messageId here — after a failed attempt the SDK
            // may have truncated the original assistant message, so targeting
            // it by id would throw "message not found". After cleanup the
            // last message is the user message the reply belongs to, and
            // regenerate() (no args) targets exactly that.
            regenerate();
          }
          startAttempt(nextTimeout);
        }, cooldown);
      } else {
        suppressingErrorRef.current = false;
        if (!retryEligible && retryAttemptRef.current <= 1) {
          console.info("NOVA: no auto-retry for this request (only edited user messages are retried)");
        } else {
          console.warn("NOVA: all retry attempts exhausted or no outgoing payload saved");
        }
        clearStreamTimer();
      }
    }, attemptTimeout);
  }, [cleanupPartialAssistantMessages, clearStreamTimer, sendMessage, stop, clearError, regenerate]);

  const startSendWithRetry = useCallback((payload: any) => {
    // Plain sends are never auto-retried — the message the user just typed is
    // theirs, not an edited version, so a silent re-send could duplicate it.
    lastOutgoingRef.current = { type: "send", payload, retryable: false, retryFn: "sendMessage" };
    retryAttemptRef.current = 0;
    suppressingErrorRef.current = false;
    lastAssistantActivityKeyRef.current = null;
    stoppedMidGenerationRef.current = false;
    settledStoppedRef.current = false;
    lastAssistantIdForStopRef.current = null;
    sendMessage(payload);
  }, [sendMessage]);

  const startRegenerateWithRetry = useCallback(
    (payload: any, options?: { retryable?: boolean; editedMessageId?: string }) => {
      const retryable = options?.retryable ?? false;
      // Only the edited-user-message flow (handleEditMessage) passes
      // retryable: true. Plain regenerations never auto-retry: the provider
      // truncates the history to the regenerated message, and re-issuing the
      // request after the state is already truncated would slice away the old
      // response entirely.
      lastOutgoingRef.current = {
        type: "regenerate",
        payload,
        retryable,
        editedMessageId: retryable ? options?.editedMessageId : undefined,
        retryFn: retryable ? "sendMessage" : "regenerate", // edit flow uses sendMessage, plain regenerate uses regenerate
      };
      retryAttemptRef.current = 0;
      suppressingErrorRef.current = false;
      lastAssistantActivityKeyRef.current = null;
      stoppedMidGenerationRef.current = false;
      settledStoppedRef.current = false;
      lastAssistantIdForStopRef.current = null;
      regenerate(payload);
      if (retryable) {
        // start watcher for initial 5s
        startAttempt(5000);
      }
    },
    [regenerate, startAttempt]
  );

  // A manual Stop click must fully cancel the retry system, not just abort
  // the in-flight fetch. Otherwise the watchdog timer scheduled by
  // startAttempt() is still armed, sees no token arrive, and auto-resends
  // the message a few seconds after the user stopped it.
  const handleStop = useCallback(() => {
    clearStreamTimer();
    lastOutgoingRef.current = null;
    retryAttemptRef.current = 0;
    suppressingErrorRef.current = false;
    stoppedMidGenerationRef.current = true;
    // Record which assistant message is being stopped so the settle effect
    // stamps the marker on the right one.
    const lastAssistant = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === "assistant");
    lastAssistantIdForStopRef.current = lastAssistant?.id ?? null;
    stop();
  }, [clearStreamTimer, stop]);

  useEffect(() => {
    if (hasPaidAccess) {
      setShowFreeTierUsage(false);
      return;
    }

    const fetchStatus = async () => {
      try {
        const response = await fetch(
          `/api/free-tier?clientId=${encodeURIComponent(clientId)}&chatId=${encodeURIComponent(chatId)}`
        );
        if (!response.ok) return;
        const data = await response.json();
        if (data && typeof data.remaining === "number" && !hasPaidAccessRef.current) {
          setFreeTierStatus(data);
          setShowFreeTierUsage(true);
        }
      } catch {
        // ignore fetch failures; free tier monitor is optional
      }
    };

    void fetchStatus();
  }, [clientId, chatId, hasPaidAccess, messages.length]);

  const displayError = useMemo(() => {
    if (!error) return "";
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (typeof (error as { message?: string }).message === "string") return (error as { message?: string }).message;
    return "An error occurred while processing your request.";
  }, [error]);

  // While a retry is scheduled, transient errors are dismissed immediately so
  // the user never sees "Failed after 3 attempts..." mid-recovery. Only the
  // final exhausted attempt keeps its error banner.
  useEffect(() => {
    if (!error || !suppressingErrorRef.current) return;
    clearError();
  }, [error, clearError]);

  // If the provider fails fast (before the watchdog timeout fires), suppress
  // the banner as long as a retry is still possible. The watchdog timer will
  // then abort + re-request. Only requests that are retry-eligible (an edited
  // user message is in flight) get this treatment — everything else surfaces
  // its error immediately.
  useEffect(() => {
    if (status !== "error") return;
    if (
      lastOutgoingRef.current?.retryable &&
      lastOutgoingRef.current.editedMessageId &&
      retryAttemptRef.current < MAX_RETRY_ATTEMPTS
    ) {
      suppressingErrorRef.current = true;
      clearError();
    }
  }, [status, clearError]);

  const isLoading = status === "submitted" || status === "streaming";

  // Compute visible messages. The `messages` array from useChat IS the active
  // path (kept in sync by handleEditMessage / handleRegenerate /
  // handleBranchNav / onFinish), so no branch substitution is needed here —
  // substituting by activeIndex would corrupt restored snapshots. We only
  // hide system messages and progress-only assistant messages.
  const computeVisibleMessages = useCallback((): UIMessage[] => {
    const result: UIMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message.role === "system") continue;
      const nextMessage = messages[i + 1];
      if (isProgressOnlyAssistantMessage(message) && nextMessage?.role === "assistant") {
        continue;
      }
      result.push(message);
    }
    return result;
  }, [messages]);

  const visibleMessages = computeVisibleMessages();
  
  // Deduplicate by id — regeneration/branch swaps can momentarily produce duplicates
  const dedupedVisibleMessages = visibleMessages.filter(
    (m, i, arr) => arr.findIndex((x) => x.id === m.id) === i
  );
  const searchActive =
    requestFeatures.webSearch &&
    isPreprocessingActive(getCurrentResponseProgressStatus(messages, "data-search"));
  const deepThinkActive =
    requestFeatures.deepThink &&
    isPreprocessingActive(getCurrentResponseProgressStatus(messages, "data-thought"));
  const filesActive =
    attachments.length > 0 &&
    isPreprocessingActive(getCurrentResponseProgressStatus(messages, "data-file"));
  const lastVisibleMessage = dedupedVisibleMessages[dedupedVisibleMessages.length - 1];
  const showTypingIndicator =
    status !== "ready" &&
    status !== "error" &&
    !searchActive &&
    !deepThinkActive &&
    !filesActive;

// The red "You stopped the response" hint follows the `data-stopped` marker
  // stamped onto the message itself when the user stops a generation. Because
  // it is a normal message part, it survives a page refresh and only ever
  // shows under the exact reply that was stopped — never on a finished branch
  // sibling. The Continue flow has been removed.
  const streamFailed = status === "error";
  // The hint now follows the `data-stopped` marker stamped on the message
  // itself, so it survives a page refresh and only ever shows under the exact
  // reply the user stopped — never on a finished branch sibling.
  const lastAssistantStopped =
    lastVisibleMessage?.role === "assistant" &&
    (lastVisibleMessage.parts as any[]).some((p) => p.type === "data-stopped");
  const interruptedKind: "text" | undefined = lastAssistantStopped ? "text" : undefined;

  useEffect(() => {
    if (isLoading && !wasLoadingRef.current) {
      shouldFollowMessagesRef.current = true;
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleFollowScroll = () => {
      const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      const scrolledUp = container.scrollTop < lastMessageScrollTopRef.current - 1;
      lastMessageScrollTopRef.current = container.scrollTop;

      // Keep a deliberate upward scroll paused even if another stream chunk
      // arrives before the browser finishes dispatching scroll events.
      if (scrolledUp) {
        shouldFollowMessagesRef.current = false;
        return;
      }

      shouldFollowMessagesRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
    };

    container.addEventListener("scroll", handleFollowScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleFollowScroll);
  }, []);

  const handleMessagesWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    // A wheel event from a code pane belongs to that pane's independent follow state.
    if (event.target instanceof Element && event.target.closest("[data-code-scroll]")) return;

    if (event.deltaY < 0) {
      shouldFollowMessagesRef.current = false;
    }
  }, []);

  const handleMessagesTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-code-scroll]")) return;
    messageTouchStartYRef.current = event.touches[0]?.clientY ?? null;
  }, []);

  const handleMessagesTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest("[data-code-scroll]")) return;

    const currentY = event.touches[0]?.clientY;
    const startY = messageTouchStartYRef.current;
    if (currentY !== undefined && startY !== null && currentY > startY) {
      shouldFollowMessagesRef.current = false;
    }
  }, []);

  const userMessages = useMemo(() => {
    return dedupedVisibleMessages.filter((m) => m.role === "user");
  }, [dedupedVisibleMessages]);

  const navItems: NavItem[] = useMemo(() => {
    return userMessages.map((message, i) => {
      const text = message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("")
        .slice(0, 60);
      return {
        id: message.id,
        text: text || `Message ${i + 1}`,
        badge: `${i + 1}/${userMessages.length}`,
      };
    });
  }, [userMessages]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || userMessages.length === 0 || isLoading) return;

    const handleScroll = () => {
      const messageElements = container.querySelectorAll("[data-message-id]");
      const userIds = new Set(userMessages.map((m) => m.id));
      let closestId: string | undefined;
      let closestDistance = Infinity;

      messageElements.forEach((el) => {
        const id = el.getAttribute("data-message-id");
        if (!id || !userIds.has(id)) return;

        const rect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const distance = Math.abs(rect.top - containerRect.top - 100);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestId = id ?? undefined;
        }
      });

      setActiveNavId(closestId);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    setTimeout(handleScroll, 100);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [userMessages, isLoading]);

  const handleNavSelect = useCallback((id: string) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-message-id="${id}"]`);
    if (el) {
      if (isLoading) shouldFollowMessagesRef.current = false;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [isLoading]);

  useEffect(() => {
    if (!isLoading || !shouldFollowMessagesRef.current) return;

    const frame = requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container && shouldFollowMessagesRef.current) {
        container.scrollTop = container.scrollHeight;
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, status, isLoading]);

  // When this chat becomes the displayed one again (it stays mounted while
  // hidden so background generations keep running), restore the scroll
  // position: if a generation was in flight (or the user was following the
  // bottom when they left), jump to the bottom so the freshly completed
  // response is visible; otherwise leave the scroll position untouched.
  const wasFollowingWhenHiddenRef = useRef(true);
  useEffect(() => {
    if (!isActive) {
      wasFollowingWhenHiddenRef.current = shouldFollowMessagesRef.current;
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      const generating = status === "submitted" || status === "streaming";
      if (generating || wasFollowingWhenHiddenRef.current) {
        container.scrollTop = container.scrollHeight;
        shouldFollowMessagesRef.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive, status]);

  // Persist messages continuously: debounced during streaming so a tab kill
  // mid-generation (e.g. switching to Telegram) never loses the conversation,
  // and immediately once generation stops.
  useEffect(() => {
    if (messages.length === 0) return;

    if (isLoading) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveTimeoutRef.current = null;
        saveMessages(chatId, messages as unknown[]);
      }, 600);
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    saveMessages(chatId, messages as unknown[]);
    // Generation finished — make sure the completed conversation also reaches
    // the server backup (debounced), not only when the page is hidden.
    backupNow({ messages: { [chatId]: messages as unknown[] } });
  }, [messages, chatId, isLoading]);

  // Flush the pending save and push the server backup when the page is
  // hidden / unloaded (the exact moment a WebView gets frozen or killed).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const flush = () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (messagesRef.current.length > 0) {
        saveMessages(chatId, messagesRef.current);
      }
      flushBackup({ messages: { [chatId]: messagesRef.current } });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [chatId]);

  useEffect(() => {
    const conversationMessages = messages.filter((message) => message.role !== "system");
    if (
      status !== "ready" ||
      summarizingHistoryRef.current ||
      conversationMessages.length < MESSAGE_LIMIT
    ) return;

    // Check if the first message is already a summary (from a previous batch)
    const firstIsSystemSummary =
      messages.length > 0 &&
      messages[0].role === "system" &&
      messages[0].parts.some(
        (p): p is { type: "text"; text: string } =>
          p.type === "text" && p.text.includes("Private summary")
      );

    const numberToSummarize = conversationMessages.length - RECENT_MESSAGES_TO_KEEP;
    if (numberToSummarize <= 0) {
      return;
    }

    const messagesToSummarize = conversationMessages.slice(0, numberToSummarize);
    const firstRetained = conversationMessages[numberToSummarize];
    const firstRetainedIndex = messages.findIndex((message) => message.id === firstRetained?.id);
    if (firstRetainedIndex < 0) return;

    const historyToSummarize = messages.slice(0, firstRetainedIndex);
    const summarizedIds = new Set(messagesToSummarize.map((message) => message.id));
    summarizingHistoryRef.current = true;

    // Mirror the paid-tier resolution used by the chat transport so the
    // summarization call uses the same server mode and code.
    const paidData = getPaidTierData();
    const serverMode = getServerMode();
    const hasActivePaidTier =
      serverMode === "paid" &&
      paidData &&
      new Date(paidData.expiresAt) > new Date();

    void fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: historyToSummarize,
        model,
        paidTierCode: hasActivePaidTier ? paidData.code : null,
        paidTierClientId: hasActivePaidTier ? getPaidTierClientId() : null,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Conversation summarization failed");
        return (await response.json()) as { summary?: string };
      })
      .then(({ summary }) => {
        if (!summary) return;
        setMessages((current) => [
          createConversationSummary(summary),
          ...current.filter(
            (message) => message.role !== "system" && !summarizedIds.has(message.id)
          ),
        ]);
      })
      .catch(() => {})
      .finally(() => {
        summarizingHistoryRef.current = false;
      });
  }, [messages, model, setMessages, status]);

  useEffect(() => {
    // Only the chat currently being DISPLAYED may fire onFirstMessage. Hidden
    // background chats (kept mounted so their generations keep running) also
    // load their existing messages on mount — firing onFirstMessage there
    // would re-navigate to that chat and yank the user out of their current
    // (possibly new/empty) chat.
    if (!isActive) return;
    if (!notifiedRef.current && messages.length >= 1) {
      const firstUser = messages.find((m) => m.role === "user");
      if (firstUser) {
        const text = firstUser.parts
          .filter((p) => p.type === "text")
          .map((p) => (p as { type: "text"; text: string }).text)
          .join("")
          .slice(0, 40);
        if (text) {
          onFirstMessage(text);
          notifiedRef.current = true;
        }
      }
    }
  }, [messages, onFirstMessage, isActive]);

  const handleAddFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;

    const acceptedFiles: File[] = [];
    let errorMsg = "";

    for (const file of Array.from(files)) {
      const mimeType = getSupportedAttachmentMimeType({ mimeType: file.type, filename: file.name });
      if (!mimeType) {
        errorMsg = `Unsupported file type. ${SUPPORTED_ATTACHMENT_DESCRIPTION}`;
        continue;
      }

      if (isImageMimeType(mimeType)) {
        errorMsg = "Image uploads are not supported.";
        continue;
      }

      const validation = validateFileSize(file);
      if (!validation.valid) {
        errorMsg = validation.error || `Unsupported file type. ${SUPPORTED_ATTACHMENT_DESCRIPTION}`;
        continue;
      }
      acceptedFiles.push(file);
    }

    // Enforce per-message caps counting what is already attached.
    const batch = validateAttachmentBatch(acceptedFiles);
    if (!batch.valid) {
      errorMsg = batch.error || errorMsg;
      setAttachmentError(errorMsg);
      return;
    }

    setAttachmentError(errorMsg);

    const next: PendingAttachment[] = acceptedFiles.map((file) => ({
      id: generateAttachmentId(),
      source: "file" as const,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setAttachments((prev) => {
      const combined = [...prev, ...next];
      const batchCheck = validateAttachmentBatch(
        combined.map((att) =>
          att.source === "file"
            ? att.file
            : { size: att.existingFile.size, type: att.existingFile.mimeType, name: att.existingFile.name }
        )
      );
      if (!batchCheck.valid) {
        // Reject the newly added files (and their object URLs) if they push
        // the message over the combined cap.
        for (const att of next) URL.revokeObjectURL(att.previewUrl);
        setAttachmentError(batchCheck.error || "");
        return prev;
      }
      return combined;
    });
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found && found.source === "file") URL.revokeObjectURL(found.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleAttachExistingFile = useCallback((file: ChatFile) => {
    const mimeType = getSupportedAttachmentMimeType({ mimeType: file.mimeType, filename: file.name });
    if (!mimeType) {
      setAttachmentError(`Unsupported file type. ${SUPPORTED_ATTACHMENT_DESCRIPTION}`);
      return;
    }

    if (isImageMimeType(mimeType)) {
      setAttachmentError("Image uploads are not supported.");
      return;
    }

    setAttachments((prev) => {
      if (prev.some((a) => a.source === "existing" && a.existingFile.id === file.id)) {
        return prev;
      }
      const combined = [...prev, { id: generateAttachmentId(), source: "existing" as const, existingFile: file, previewUrl: file.dataUrl }];
      const batchCheck = validateAttachmentBatch(
        combined.map((att) =>
          att.source === "file"
            ? att.file
            : { size: att.existingFile.size, type: att.existingFile.mimeType, name: att.existingFile.name }
        )
      );
      if (!batchCheck.valid) {
        setAttachmentError(batchCheck.error || "");
        return prev;
      }
      return combined;
    });
  }, []);

  const handleContinue = useCallback(() => {
    // The Continue feature has been removed. Retained as a no-op so any stale
    // call site stays harmless.
  }, []);

  const handleSubmit = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const text = input;
    const pending = attachments;
    setRequestFeatures({ deepThink, webSearch });
    setInput("");
    setAttachments([]);
    setAttachmentError("");

    if (pending.length === 0) {
      // A plain (non-edited) send is never auto-retried — startSendWithRetry
      // issues it once and failures surface as an error banner.
      startSendWithRetry({ text });
      return;
    }

    const files = await Promise.all(
      pending.map(async (att) => {
        if (att.source === "existing") {
          const mimeType = getSupportedAttachmentMimeType({
            mimeType: att.existingFile.mimeType,
            filename: att.existingFile.name,
          }) || "application/octet-stream";
          return {
            type: "file" as const,
            url: normalizeDataUrl(att.existingFile.dataUrl, mimeType),
            mediaType: mimeType,
            filename: att.existingFile.name,
          };
        }
        const mimeType =
          getSupportedAttachmentMimeType({ mimeType: att.file.type, filename: att.file.name }) ??
          "application/octet-stream";
        return {
          type: "file" as const,
          url: await fileToDataUrl(att.file, mimeType),
          mediaType: mimeType,
          filename: att.file.name,
        };
      })
    );

    // A plain (non-edited) send is never auto-retried (see above).
    startSendWithRetry({ text, files });

    // The blob preview URLs were only needed for the input-bar thumbnails;
    // the message itself now carries the base64 data URL, so free them.
    for (const att of pending) {
      if (att.source === "file") URL.revokeObjectURL(att.previewUrl);
    }
  };

  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      if (isLoading) return;

      const idx = messages.findIndex((m) => m.id === messageId);
      if (idx === -1) return;

      // Create a branch group for THIS user message.
      // The group key is the user message's ORIGINAL ID — if this message is
      // already a version (`::vN`), resolve back to the original group so the
      // edit adds a sibling version instead of an orphaned group.
      const groupId = branchGroupForMessageRef.current[messageId] ?? messageId;
      const existingGroup = branchGroups[groupId];

      // Refresh the CURRENT (leaving) version's branch with the full tail
      // from this message BEFORE truncating — follow-ups sent while this
      // version was displayed must stay inside its branch snapshot.
      const branches = existingGroup ? existingGroup.branches.slice() : [];
      if (existingGroup) {
        branches[existingGroup.activeIndex] = {
          messages: messages.slice(idx),
          childBranchIds: existingGroup.branches[existingGroup.activeIndex]?.childBranchIds ?? [],
        };
      } else {
        branches.push({ messages: messages.slice(idx), childBranchIds: [] });
      }
      const baseGroup: BranchGroup = {
        branches,
        activeIndex: existingGroup ? existingGroup.activeIndex : 0,
        parentMessageId: idx > 0 ? messages[idx - 1]?.id ?? null : null,
      };
      if (!existingGroup) {
        branchGroupForMessageRef.current[groupId] = groupId;
      }

      const newVersionId = `${groupId}::v${baseGroup.branches.length + 1}`;
      const editedMessage = {
        ...messages[idx],
        id: newVersionId,
        parts: [
          ...messages[idx].parts.filter((p) => p.type !== "text"),
          { type: "text" as const, text: newText },
        ],
      };

      branchGroupForMessageRef.current[newVersionId] = groupId;
      noAnimateIdsRef.add(newVersionId);

      setBranchGroups((g) => ({
        ...g,
        [groupId]: {
          branches: [...baseGroup.branches, { messages: [editedMessage], childBranchIds: [] }],
          activeIndex: baseGroup.branches.length,
          parentMessageId: baseGroup.parentMessageId,
        },
      }));

      setMessages([...messages.slice(0, idx), editedMessage]);
      setRequestFeatures({ deepThink, webSearch });

      // Trigger the regeneration for the edited message.
      // The edit flow uses sendMessage (re-send last user message) for retries,
      // not regenerate (which expects an assistant message ID).
      startRegenerateWithRetry(undefined, { retryable: true, editedMessageId: newVersionId });
    },
    [branchGroups, deepThink, isLoading, messages, setMessages, webSearch]
  );

  // Once a (re)generation finishes, snapshot the freshly produced tail back
  // into whichever branch is currently active, so switching away and back
  // to this version preserves its own response instead of a stale one.
  // For assistant message regeneration, also create a new branch version.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasLoading = prevStatusRef.current === "submitted" || prevStatusRef.current === "streaming";
    prevStatusRef.current = status;
    if (!wasLoading || status !== "ready") return;

    // Handle assistant message regeneration as a new branch version
    const isRegeneratingAssistant = regeneratingAssistantIdRef.current !== null;
    if (isRegeneratingAssistant) {
      const oldAssistantId = regeneratingAssistantIdRef.current!;
      regeneratingAssistantIdRef.current = null;

      // NOTE: the AI SDK's regenerate() TRUNCATES the messages array at the
      // regenerated assistant message — the old assistant id is GONE from
      // `messages`. The new response was streamed in as the last assistant
      // message, so find the NEW assistant at the end of the array.
      let newAssistantIdx = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          newAssistantIdx = i;
          break;
        }
      }
      if (newAssistantIdx === -1) return;

      // Resolve the group key the same way handleRegenerate did — if the
      // regenerated assistant was itself a version, the group lives under
      // the ORIGINAL assistant id.
      const groupId = branchGroupForMessageRef.current[oldAssistantId] ?? oldAssistantId;
      const group = branchGroups[groupId];
      if (!group) return;

      const newAssistantId = messages[newAssistantIdx].id;

      setBranchGroups((g) => {
        const grp = g[groupId];
        if (!grp) return g;

        const branches = grp.branches.slice();
        // Check if we already have this new version (re-streamed)
        const newVersionExists = branches.some(
          (b: MessageBranch) =>
            b.messages.length > 0 && b.messages[b.messages.length - 1].id === newAssistantId
        );

        if (!newVersionExists) {
          // Add the new regenerated response as a new branch version —
          // sibling of the old assistant (same parent), NOT a child.
          branches.push({ messages: messages.slice(newAssistantIdx), childBranchIds: [] });
        }

        // Switch to the new version
        const newActiveIndex = branches.length - 1;
        for (const m of messages.slice(newAssistantIdx)) {
          noAnimateIdsRef.add(m.id);
        }
        // Map the new version's head back to its group
        branchGroupForMessageRef.current[newAssistantId] = groupId;

        return { ...g, [groupId]: { ...grp, branches, activeIndex: newActiveIndex } };
      });
    } else {
      // Normal generation (new send or edited-message regeneration).
      // Walk every message in the current array: for each message that is
      // the ACTIVE HEAD of a branch group (i.e. the version currently
      // displayed), extend that group's active branch with the full tail
      // from that message. This keeps follow-ups sent after a response
      // inside the correct branch — including user groups whose root sits
      // ABOVE the last user message (edited versions) and assistant groups.
      const groupUpdates: Record<string, BranchGroup> = {};
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const groupId = branchGroupForMessageRef.current[m.id];
        if (!groupId) continue;
        const grp = branchGroups[groupId];
        if (!grp) continue;
        const activeHead = grp.branches[grp.activeIndex]?.messages[0];
        if (!activeHead || activeHead.id !== m.id) continue;
        groupUpdates[groupId] = {
          ...grp,
          branches: grp.branches.map((b, bi) =>
            bi === grp.activeIndex
              ? { messages: messages.slice(i), childBranchIds: b.childBranchIds ?? [] }
              : b
          ),
        };
      }
      if (Object.keys(groupUpdates).length > 0) {
        setBranchGroups((g) => ({ ...g, ...groupUpdates }));
      }

      // NOTE: we deliberately do NOT pre-create a branch group for every
      // freshly streamed assistant message here. Doing so stored a duplicate
      // copy of the conversation tail after EVERY reply — O(n²) localStorage
      // growth that eventually exhausted the quota, at which point
      // saveMessages() failed and assistant replies silently vanished.
      //
      // A group is only needed once a message actually HAS a second version,
      // and handleRegenerate() creates it on demand (it resolves
      // `branchGroupForMessageRef.current[messageId] ?? messageId`, so a
      // missing group is the normal, expected starting state).
    }
  }, [status, messages, branchGroups]);

  // Persist versions alongside the conversation so they survive a refresh.
  useEffect(() => {
    saveBranchGroups(chatId, branchGroups);
  }, [chatId, branchGroups]);

  // Resolve the branch group that governs a message: look up the message's
  // branch group directly (each message with versions has its own group).
  const resolveGroupForMessage = useCallback(
    (messageId: string): { groupId: string; group: BranchGroup | undefined } => {
      const groupId = branchGroupForMessageRef.current[messageId];
      if (!groupId) return { groupId: "", group: undefined };
      return { groupId, group: branchGroups[groupId] };
    },
    [branchGroups]
  );

  const getBranchInfo = useCallback(
    (messageId: string) => {
      const { groupId, group } = resolveGroupForMessage(messageId);
      if (!groupId || !group || group.branches.length < 2) return undefined;
      return { current: group.activeIndex + 1, total: group.branches.length };
    },
    [resolveGroupForMessage]
  );

  const handleBranchNav = useCallback(
    (messageId: string, direction: "prev" | "next") => {
      if (isLoading) return;
      // Switching the displayed branch means we are no longer looking at the
      // reply that was manually stopped, so clear the stopped hint — otherwise
      // "You stopped the response" would wrongly show under the now-selected
      // (finished) version. The hint is now driven by the per-message
      // `data-stopped` marker, but we still reset the in-flight flag here.
      stoppedMidGenerationRef.current = false;
      lastAssistantIdForStopRef.current = null;
      const { groupId, group } = resolveGroupForMessage(messageId);
      if (!groupId || !group) return;

      const newIndex = direction === "prev" ? group.activeIndex - 1 : group.activeIndex + 1;
      if (newIndex < 0 || newIndex >= group.branches.length) return;

      // Save the currently visible tail from this message onward into the
      // branch we are leaving
      const msgIdx = messages.findIndex((m) => m.id === messageId);
      if (msgIdx === -1) return;

      const branches = group.branches.slice();
      branches[group.activeIndex] = {
        messages: messages.slice(msgIdx),
        childBranchIds: group.branches[group.activeIndex]?.childBranchIds ?? [],
      };

      const nextBranch = branches[newIndex];
      const nextMessages = nextBranch.messages;

      // Mark new messages as no-animate
      for (const m of nextMessages) noAnimateIdsRef.add(m.id);

      // Update branchGroupForMessageRef for the new head messages
      if (nextMessages.length > 0) {
        branchGroupForMessageRef.current[nextMessages[0].id] = groupId;
      }

      // Update the branch group — AND any nested branch groups whose active
      // version appears in the restored snapshot, so their switcher counters
      // point at the version actually being displayed (never mix versions).
      setBranchGroups((g) => {
        const next: Record<string, BranchGroup> = {
          [groupId]: { ...group, branches, activeIndex: newIndex },
        };
        for (const m of nextMessages) {
          const nestedGroupId = branchGroupForMessageRef.current[m.id];
          const nestedGroup = nestedGroupId ? g[nestedGroupId] : undefined;
          if (!nestedGroupId || !nestedGroup || nestedGroup.branches.length < 2) continue;
          const versionIndex = nestedGroup.branches.findIndex(
            (b) => b.messages[0]?.id === m.id
          );
          if (versionIndex !== -1 && versionIndex !== nestedGroup.activeIndex) {
            next[nestedGroupId] = { ...nestedGroup, activeIndex: versionIndex };
          }
        }
        return { ...g, ...next };
      });

      // Replace messages from this message onward with the selected branch
      setMessages([...messages.slice(0, msgIdx), ...nextMessages]);
    },
    [branchGroups, isLoading, messages, resolveGroupForMessage, setMessages]
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      if (isLoading) return;

      const assistantIdx = messages.findIndex((m) => m.id === messageId);
      if (assistantIdx === -1) return;

      // Create a branch group for THIS assistant message.
      // The group key is the assistant message's ORIGINAL id — if this
      // assistant is already a version (a prior retry), resolve back to the
      // original group so the retry adds a SIBLING version (same parent).
      const groupId = branchGroupForMessageRef.current[messageId] ?? messageId;
      const existingGroup = branchGroups[groupId];

      // The currently displayed assistant message + its downstream is the
      // version we are leaving. Refresh its tail in the group so switching
      // back later restores the exact subtree (including follow-ups sent
      // while it was displayed).
      const branches = existingGroup ? existingGroup.branches.slice() : [];
      if (existingGroup) {
        branches[existingGroup.activeIndex] = {
          messages: messages.slice(assistantIdx),
          childBranchIds: existingGroup.branches[existingGroup.activeIndex]?.childBranchIds ?? [],
        };
      } else {
        branches.push({ messages: messages.slice(assistantIdx), childBranchIds: [] });
      }
      const baseGroup: BranchGroup = {
        branches,
        activeIndex: existingGroup ? existingGroup.activeIndex : 0,
        parentMessageId: messages[assistantIdx - 1]?.id ?? null,
      };
      if (!existingGroup) {
        branchGroupForMessageRef.current[groupId] = groupId;
      }

      // Mark this as a regeneration so onFinish captures the NEW response as
      // a new sibling version.
      regeneratingAssistantIdRef.current = messageId;

      setBranchGroups((g) => ({
        ...g,
        [groupId]: baseGroup,
      }));

      setRequestFeatures({ deepThink, webSearch });
      startRegenerateWithRetry({ messageId });
    },
    [branchGroups, deepThink, isLoading, messages, setMessages, webSearch]
  );

  const isEmpty = messages.length === 0;

  return (
    <div className="relative flex flex-col h-full w-full bg-[#0d0d0d] overflow-hidden">
      {/* Empty state / Welcome */}
      {isEmpty ? (
        <div className="flex flex-col flex-1 items-center justify-center gap-5 sm:gap-8 px-3 sm:px-4">
          {/* Logo + title */}
          <div className="flex items-center gap-2.5 sm:gap-3 text-center">
            <Image src="/nova-logo.png" alt="NOVA" width={32} height={32} className="rounded-lg sm:rounded-xl w-8 h-8 sm:w-10 sm:h-10" />
            <h1 className="text-lg sm:text-2xl font-semibold text-white">Start chatting with NOVA</h1>
          </div>

          {/* Dynamic Island Model Switcher */}
          <div className="relative">
            <div className="relative flex items-center gap-0.5 sm:gap-1 bg-[#0a0a0c]/95 border border-white/10 rounded-full p-1 sm:p-1.5">
              {MODEL_TABS.map((tab) => {
                const isPaidOnly = isPaidOnlyModel(tab.id);
                const isActive = model === tab.id;
                const isLocked = isPaidOnly && !hasPaidAccess;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      if (isLocked) {
                        openPaidTierDialog();
                        return;
                      }
                      onModelChange(tab.id);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-[11px] sm:text-xs font-semibold transition-all duration-300 select-none",
                      isActive
                        ? "bg-white/15 text-white border border-white/25"
                        : isLocked
                          ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                          : "text-[#888c99] hover:text-white hover:bg-white/5"
                    )}
                    disabled={isLocked}
                    title={isLocked ? "Requires paid tier" : undefined}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input in Empty State */}
          <div className="w-full max-w-3xl">
            <ChatInput
              input={input}
              onInputChange={setInput}
              onSubmit={handleSubmit}
              onStop={handleStop}
              isLoading={isLoading}
              model={model}
              deepThink={deepThink}
              onToggleDeepThink={() => setDeepThink((v) => !v)}
              thinkEffort={thinkEffort}
              webSearch={webSearch}
              onToggleWebSearch={() => setWebSearch((v) => !v)}
              webSearchDisabled={attachments.length > 0}
              attachments={attachments}
              attachmentError={attachmentError}
              onAddFiles={handleAddFiles}
              onRemoveAttachment={handleRemoveAttachment}
              existingFiles={existingFiles}
              onAttachExistingFile={handleAttachExistingFile}
              freeTierStatus={freeTierStatus}
              showFreeTierUsage={showFreeTierUsage}
              isPaidUser={hasPaidAccess}
              isEmpty={isEmpty}
            />
          </div>
        </div>
      ) : (
        <>
          {!(isMobile && sidebarOpen) && (
            <>
              {/* Top Floating Dynamic Island Header */}
              {/* Uses `fixed` (not absolute) so it stays pinned to the viewport
                  through any scroll, exactly like the sidebar opener. top-4 (1rem)
                  matches the opener; the safe-area floor clears notched devices. */}
              <div className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-40 pointer-events-auto">
                <div className="relative">
                  <div className="relative flex items-center gap-0.5 sm:gap-1 bg-[#0a0a0c]/95 border border-white/10 rounded-full p-1">
                    {MODEL_TABS.map((tab) => {
                      const isPaidOnly = isPaidOnlyModel(tab.id);
                      const isActive = model === tab.id;
                      const isLocked = isPaidOnly && !hasPaidAccess;
                      return (
                        <button
                          key={tab.id}
                          onClick={() => {
                            if (isLocked) {
                              openPaidTierDialog();
                              return;
                            }
                            onModelChange(tab.id);
                          }}
                          className={cn(
                            "flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-semibold transition-all duration-300 select-none",
                            isActive
                              ? "bg-white/15 text-white border border-white/25"
                              : isLocked
                                ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                : "text-[#888c99] hover:text-white hover:bg-white/5"
                          )}
                          disabled={isLocked}
                          title={isLocked ? "Requires paid tier" : undefined}
                        >
                          {tab.icon}
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Messages Container */}
          <div
            ref={messagesContainerRef}
            onWheel={handleMessagesWheel}
            onTouchStart={handleMessagesTouchStart}
            onTouchMove={handleMessagesTouchMove}
            className="flex-1 overflow-y-auto px-2 sm:px-4 pt-20 sm:pt-16 pb-40 sm:pb-48"
          >
            {/* Fades in once, on mount — i.e. whenever a whole conversation is
                opened or switched to (ChatView remounts per chatId). This is
                separate from the flat swap used for edit-version branch nav
                and from the per-message animation for freshly sent/streamed
                messages below. */}
            <div className="max-w-3xl mx-auto animate-in fade-in duration-300">
              {dedupedVisibleMessages.map((message, i) => {
                const isLastAssistant = i === dedupedVisibleMessages.length - 1 && message.role === "assistant";
                const isCurrentStreamingAssistant = isLastAssistant && isLoading;
                return (
                  <div key={message.id} data-message-id={message.id}>
                    <ChatMessage
                      message={message}
                      onRegenerate={
                        message.role === "assistant"
                          ? () => handleRegenerate(message.id)
                          : undefined
                      }
                      onEdit={message.role === "user" ? handleEditMessage : undefined}
                      branchInfo={getBranchInfo(message.id)}
                      onBranchNav={
                        getBranchInfo(message.id)
                          ? (direction) => handleBranchNav(message.id, direction)
                          : undefined
                      }
                      isStreaming={isCurrentStreamingAssistant}
                      interrupted={isLastAssistant ? interruptedKind : undefined}
                      disableActions={isLoading}
                      animateIn={!noAnimateIdsRef.has(message.id)}
                    />
                  </div>
                );
              })}
              {showTypingIndicator && <TypingIndicator />}
              {displayError && (
                <div className="flex gap-2.5 sm:gap-4 w-full max-w-3xl mx-auto py-3 sm:py-4">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden flex-shrink-0 mt-1">
                    <Image src="/nova-logo.png" alt="NOVA" width={20} height={20} className="w-[18px] h-[18px] sm:w-[20px] sm:h-[20px]" />
                  </div>
                  <div className="flex-1 text-xs sm:text-sm leading-relaxed text-[#e87070] bg-[#1e1010] border border-[#3a1a1a] rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3">
                    {displayError}
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          {/* Message Navigator */}
          {navItems.length > 0 && (
            <MessageNavigator
              items={navItems}
              activeId={activeNavId}
              onSelect={handleNavSelect}
            />
          )}

          {/* Floating Bottom Input Bar */}
          <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none bg-[#0d0d0d] pb-3 sm:pb-5 px-2 sm:px-4">
            <div className="pointer-events-auto">
              <ChatInput
                input={input}
                onInputChange={setInput}
                onSubmit={handleSubmit}
                onStop={handleStop}
                isLoading={isLoading}
                model={model}
                deepThink={deepThink}
                onToggleDeepThink={() => setDeepThink((v) => !v)}
                thinkEffort={thinkEffort}
                webSearch={webSearch}
                onToggleWebSearch={() => setWebSearch((v) => !v)}
                webSearchDisabled={attachments.length > 0}
                attachments={attachments}
                attachmentError={attachmentError}
                onAddFiles={handleAddFiles}
                onRemoveAttachment={handleRemoveAttachment}
                existingFiles={existingFiles}
                onAttachExistingFile={handleAttachExistingFile}
                freeTierStatus={freeTierStatus}
                showFreeTierUsage={showFreeTierUsage}
                isPaidUser={hasPaidAccess}
              isEmpty={isEmpty}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
