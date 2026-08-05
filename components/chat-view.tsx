"use client";

import { useRef, useEffect, useState, useCallback, useMemo, type TouchEvent, type WheelEvent } from "react";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { Zap, Shield } from "lucide-react";
import { ChatInput, PendingAttachment } from "./chat-input";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { MessageNavigator, NavItem } from "@/app/message-navigator";
import { cn } from "@/lib/utils";
import { loadMessages, saveMessages, ModelParams, ChatFile, loadChatFiles } from "@/lib/storage";
import { getSupportedAttachmentMimeType, isImageMimeType, normalizeDataUrl, validateFileSize, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";
import { getPaidTierClientId, getPaidTierData, getServerMode } from "@/lib/paid-tier";

type Model = "instant" | "expert";

const MESSAGE_LIMIT = 50;
const RECENT_MESSAGES_TO_KEEP = 46;
const SCROLL_BOTTOM_THRESHOLD = 24;

type Props = {
  chatId: string;
  model: Model;
  modelSettings?: ModelParams;
  onModelChange: (m: Model) => void;
  onFirstMessage: (title: string) => void;
};

const MODEL_TABS: { id: Model; label: string; icon: React.ReactNode }[] = [
  { id: "instant", label: "Instant", icon: <Zap className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> },
  { id: "expert", label: "Expert", icon: <Shield className="w-3 h-3 sm:w-3.5 sm:h-3.5" /> },
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
    message.parts.some((part) => part.type === "data-search" || part.type === "data-thought") &&
    !message.parts.some((part) => part.type === "text")
  );
}

function getCurrentResponseProgressStatus(
  messages: UIMessage[],
  partType: "data-search" | "data-thought"
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

function isCompletedPreprocessingStatus(status: string | undefined) {
  return status === "done" || status === "error";
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

export function ChatView({ chatId, model, modelSettings, onModelChange, onFirstMessage }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldFollowMessagesRef = useRef(true);
  const lastMessageScrollTopRef = useRef(0);
  const messageTouchStartYRef = useRef<number | null>(null);
  const wasLoadingRef = useRef(false);
  const notifiedRef = useRef(false);
  const summarizingHistoryRef = useRef(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeNavId, setActiveNavId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [deepThink, setDeepThink] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [requestFeatures, setRequestFeatures] = useState({ deepThink: false, webSearch: false });
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [pendingRegenerateAfterEdit, setPendingRegenerateAfterEdit] = useState(false);
  const [existingFiles, setExistingFiles] = useState<ChatFile[]>([]);
  const [freeTierStatus, setFreeTierStatus] = useState<{
    count: number;
    remaining: number;
    blocked: boolean;
    blockedUntil?: string;
  } | null>(null);
  const [showFreeTierUsage, setShowFreeTierUsage] = useState(false);

  const initialMessages = useRef(loadMessages(chatId)).current;

  useEffect(() => {
    setExistingFiles(loadChatFiles(chatId));
  }, [chatId]);

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
  const hasPaidAccess = (() => {
    const paidData = getPaidTierData();
    const serverMode = getServerMode();
    return (
      serverMode === "paid" &&
      paidData &&
      new Date(paidData.expiresAt) > new Date()
    );
  })();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        fetch: fetchTransport,
        body: bodyTransport,
      }),
    [fetchTransport, bodyTransport]
  );

  const { messages, sendMessage, status, error, regenerate, setMessages, stop } = useChat({
    id: chatId,
    messages: initialMessages as never,
    transport,
    throttle: 200,
  });

  // Retry controller refs and helpers
  const retryAttemptRef = useRef(0);
  const lastOutgoingRef = useRef<null | { type: "send" | "regenerate"; payload: any }>(null);
  const streamTimerRef = useRef<NodeJS.Timeout | null>(null);
  const firstTokenReceivedRef = useRef(false);
  const lastAssistantTextLengthRef = useRef(0);

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
      // Keep messages up to last user message
      return current.slice(0, lastUserIndex + 1);
    });
  }, [setMessages]);

  const handleFirstTokenSeen = useCallback(() => {
    firstTokenReceivedRef.current = true;
    retryAttemptRef.current = 0;
    clearStreamTimer();
  }, [clearStreamTimer]);

  // Monitor messages to detect first assistant token arrival
  useEffect(() => {
    // compute current assistant text length in the last assistant message
    let currentLen = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant") {
        for (const p of m.parts) {
          if (p.type === "text") currentLen += String((p as any).text || "").length;
        }
        break;
      }
    }

    if (currentLen > lastAssistantTextLengthRef.current) {
      // first token (or more) arrived
      lastAssistantTextLengthRef.current = currentLen;
      handleFirstTokenSeen();
    }
  }, [messages, handleFirstTokenSeen]);

  const startAttempt = useCallback(async (attemptTimeout: number) => {
    const attempt = ++retryAttemptRef.current;
    console.info(`NOVA: starting stream attempt ${attempt}`);

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
      // decide whether to retry
      if (retryAttemptRef.current < 3 && lastOutgoingRef.current) {
        // Next attempts use 10s
        const nextTimeout = 10000;
        // re-send the same payload
        const saved = lastOutgoingRef.current;
        if (saved.type === "send") {
          // small delay to allow abort to settle, then re-send and start next attempt watcher
          setTimeout(() => {
            sendMessage(saved.payload);
            startAttempt(nextTimeout);
          }, 50);
        } else if (saved.type === "regenerate") {
          setTimeout(() => {
            regenerate(saved.payload);
            startAttempt(nextTimeout);
          }, 50);
        }
      } else {
        console.warn("NOVA: all retry attempts exhausted or no outgoing payload saved");
        clearStreamTimer();
      }
    }, attemptTimeout);
  }, [cleanupPartialAssistantMessages, clearStreamTimer, regenerate, sendMessage, stop]);

  const startSendWithRetry = useCallback((payload: any) => {
    lastOutgoingRef.current = { type: "send", payload };
    retryAttemptRef.current = 0;
    lastAssistantTextLengthRef.current = 0;
    // initial attempt
    sendMessage(payload);
    // start watcher for initial 5s
    startAttempt(5000);
  }, [sendMessage, startAttempt]);

  const startRegenerateWithRetry = useCallback((payload: any) => {
    lastOutgoingRef.current = { type: "regenerate", payload };
    retryAttemptRef.current = 0;
    lastAssistantTextLengthRef.current = 0;
    regenerate(payload);
    startAttempt(5000);
  }, [regenerate, startAttempt]);

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
        if (data && typeof data.remaining === "number") {
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

  const isLoading = status === "submitted" || status === "streaming";
  const visibleMessages = messages.filter((message, index) => {
    if (message.role === "system") return false;
    const nextMessage = messages[index + 1];
    if (
      isProgressOnlyAssistantMessage(message) &&
      nextMessage?.role === "assistant"
    ) {
      return false;
    }
    return true;
  });
  const searchComplete =
    !requestFeatures.webSearch ||
    isCompletedPreprocessingStatus(getCurrentResponseProgressStatus(messages, "data-search"));
  const deepThinkComplete =
    !requestFeatures.deepThink ||
    isCompletedPreprocessingStatus(getCurrentResponseProgressStatus(messages, "data-thought"));
  const showTypingIndicator =
    status !== "ready" && status !== "error" && searchComplete && deepThinkComplete;

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
    return visibleMessages.filter((m) => m.role === "user");
  }, [visibleMessages]);

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

  useEffect(() => {
    if (isLoading) {
      // Don't save during streaming; clear any pending save
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      return;
    }

    // After streaming stops, save immediately
    if (messages.length > 0) {
      saveMessages(chatId, messages as unknown[]);
    }
  }, [messages, chatId, isLoading]);

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

    void fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: historyToSummarize, model }),
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
  }, [messages, onFirstMessage]);

  useEffect(() => {
    if (pendingRegenerateAfterEdit) {
      setPendingRegenerateAfterEdit(false);
      startRegenerateWithRetry(undefined);
    }
  }, [pendingRegenerateAfterEdit]);

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

    setAttachmentError(errorMsg);

    const next: PendingAttachment[] = acceptedFiles.map((file) => ({
      id: generateAttachmentId(),
      source: "file" as const,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setAttachments((prev) => [...prev, ...next]);
  }, [model]);

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
      return [
        ...prev,
        {
          id: generateAttachmentId(),
          source: "existing" as const,
          existingFile: file,
          previewUrl: file.dataUrl,
        },
      ];
    });
  }, [model]);

  const handleSubmit = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const text = input;
    const pending = attachments;
    setRequestFeatures({ deepThink, webSearch });
    setInput("");
    setAttachments([]);
    setAttachmentError("");

    if (pending.length === 0) {
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

    startSendWithRetry({ text, files });
  };

  const handleEditMessage = useCallback(
    (messageId: string, newText: string) => {
      if (isLoading) return;
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx === -1) return prev;
        const editedMessage = {
          ...prev[idx],
          parts: [
            ...prev[idx].parts.filter((p) => p.type !== "text"),
            { type: "text" as const, text: newText },
          ],
        };
        return [...prev.slice(0, idx), editedMessage];
      });
      setRequestFeatures({ deepThink, webSearch });
      setPendingRegenerateAfterEdit(true);
    },
    [deepThink, isLoading, setMessages, webSearch]
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      setRequestFeatures({ deepThink, webSearch });
      startRegenerateWithRetry({ messageId });
    },
    [deepThink, regenerate, webSearch]
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
          <div className="relative group">
            <div className="absolute -inset-1 rounded-full bg-white/20 blur-md opacity-50 group-hover:opacity-80 transition duration-500 pointer-events-none" />
            <div className="relative flex items-center gap-0.5 sm:gap-1 bg-[#0a0a0c]/85 backdrop-blur-2xl border border-white/20 rounded-full p-1 sm:p-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
              {MODEL_TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => onModelChange(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 sm:px-4 sm:py-2 rounded-full text-[11px] sm:text-xs font-semibold transition-all duration-300 select-none",
                    model === tab.id
                      ? "bg-white/15 text-white border border-white/25 shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                      : "text-[#888c99] hover:text-white hover:bg-white/5"
                  )}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Input in Empty State */}
          <div className="w-full max-w-3xl">
            <ChatInput
              input={input}
              onInputChange={setInput}
              onSubmit={handleSubmit}
              onStop={stop}
              isLoading={isLoading}
              model={model}
              deepThink={deepThink}
              onToggleDeepThink={() => setDeepThink((v) => !v)}
              webSearch={webSearch}
              onToggleWebSearch={() => setWebSearch((v) => !v)}
              attachments={attachments}
              attachmentError={attachmentError}
              onAddFiles={handleAddFiles}
              onRemoveAttachment={handleRemoveAttachment}
              existingFiles={existingFiles}
              onAttachExistingFile={handleAttachExistingFile}
              freeTierStatus={freeTierStatus}
              showFreeTierUsage={showFreeTierUsage}
            />
          </div>
        </div>
      ) : (
        <>
          {/* Top Floating Dynamic Island Header */}
          <div className="absolute top-2.5 sm:top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-full bg-white/20 blur-md opacity-60 group-hover:opacity-90 transition duration-500 pointer-events-none" />
              <div className="relative flex items-center gap-0.5 sm:gap-1 bg-[#0a0a0c]/85 backdrop-blur-2xl border border-white/20 rounded-full p-1 shadow-[0_10px_30px_rgba(0,0,0,0.8)]">
                {MODEL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => onModelChange(tab.id)}
                    className={cn(
                      "flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 sm:px-3.5 sm:py-1.5 rounded-full text-[11px] sm:text-xs font-semibold transition-all duration-300 select-none",
                      model === tab.id
                        ? "bg-white/15 text-white border border-white/25 shadow-[0_0_10px_rgba(255,255,255,0.15)]"
                        : "text-[#888c99] hover:text-white hover:bg-white/5"
                    )}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Messages Container */}
          <div
            ref={messagesContainerRef}
            onWheel={handleMessagesWheel}
            onTouchStart={handleMessagesTouchStart}
            onTouchMove={handleMessagesTouchMove}
            className="flex-1 overflow-y-auto px-2 sm:px-4 pt-12 sm:pt-16 pb-40 sm:pb-48"
          >
            <div className="max-w-3xl mx-auto">
              {visibleMessages.map((message, i) => {
                const isLastAssistant = i === visibleMessages.length - 1 && message.role === "assistant";
                const isCurrentStreamingAssistant = isLastAssistant && status === "streaming";
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
                      isStreaming={isCurrentStreamingAssistant}
                      disableActions={isCurrentStreamingAssistant}
                    />
                  </div>
                );
              })}
              {showTypingIndicator && <TypingIndicator />}
              {displayError && (
                <div className="flex gap-2.5 sm:gap-4 w-full max-w-3xl mx-auto py-3 sm:py-4">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden flex-shrink-0 mt-1">
                    <img src="/nova-logo.png" alt="NOVA" width={18} height={18} className="sm:w-[20px] sm:h-[20px]" />
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

          {/* Floating Bottom Input Bar with Soft Gradient Mask */}
          <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none bg-gradient-to-t from-[#0d0d0d] via-[#0d0d0d]/85 to-transparent pt-6 sm:pt-10 pb-3 sm:pb-5 px-2 sm:px-4">
            <div className="pointer-events-auto">
              <ChatInput
                input={input}
                onInputChange={setInput}
                onSubmit={handleSubmit}
                onStop={stop}
                isLoading={isLoading}
                model={model}
                deepThink={deepThink}
                onToggleDeepThink={() => setDeepThink((v) => !v)}
                webSearch={webSearch}
                onToggleWebSearch={() => setWebSearch((v) => !v)}
                attachments={attachments}
                attachmentError={attachmentError}
                onAddFiles={handleAddFiles}
                onRemoveAttachment={handleRemoveAttachment}
                existingFiles={existingFiles}
                onAttachExistingFile={handleAttachExistingFile}
                freeTierStatus={freeTierStatus}
                showFreeTierUsage={showFreeTierUsage}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
