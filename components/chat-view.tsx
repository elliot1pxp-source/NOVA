"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Zap, Shield } from "lucide-react";
import { ChatInput, PendingAttachment } from "./chat-input";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { MessageNavigator, NavItem } from "@/app/message-navigator";
import { cn } from "@/lib/utils";
import { loadMessages, saveMessages, ModelParams, ChatFile, loadChatFiles } from "@/lib/storage";
import { getSupportedAttachmentMimeType, normalizeDataUrl, validateFileSize, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";
import { getPaidTierData, getServerMode } from "@/lib/paid-tier";

type Model = "instant" | "expert";

const MESSAGE_LIMIT = 50;
const RECENT_MESSAGES_TO_KEEP = 46;

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
  const notifiedRef = useRef(false);
  const summarizingHistoryRef = useRef(false);
  const [activeNavId, setActiveNavId] = useState<string | undefined>(undefined);
  const [input, setInput] = useState("");
  const [deepThink, setDeepThink] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [pendingRegenerateAfterEdit, setPendingRegenerateAfterEdit] = useState(false);
  const [existingFiles, setExistingFiles] = useState<ChatFile[]>([]);

  const initialMessages = useRef(loadMessages(chatId)).current;

  useEffect(() => {
    setExistingFiles(loadChatFiles(chatId));
  }, [chatId]);

  const { messages, sendMessage, status, error, regenerate, setMessages } = useChat({
    id: chatId,
    messages: initialMessages as never,
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: () => {
        const paidData = getPaidTierData();
        const serverMode = getServerMode();
        const paidTierCode = serverMode === "paid" && paidData ? paidData.code : null;
        return { model, deepThink, webSearch, modelSettings, paidTierCode };
      },
    }),
  });

  const isLoading = status === "submitted" || status === "streaming";
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === "assistant");
  const waitingForDeepThink =
    isLoading && lastAssistantMessage && isProgressOnlyAssistantMessage(lastAssistantMessage);
  const visibleMessages = messages.filter((message, index) => {
    if (message.role === "system") return false;
    return !(
      isProgressOnlyAssistantMessage(message) &&
      messages[index + 1]?.role === "assistant"
    );
  });
  const showTypingIndicator = isLoading && !waitingForDeepThink;

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
    if (!container || userMessages.length === 0) return;

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
  }, [userMessages]);

  const handleNavSelect = useCallback((id: string) => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-message-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(chatId, messages as unknown[]);
    }
  }, [messages, chatId]);

  useEffect(() => {
    const conversationMessages = messages.filter((message) => message.role !== "system");
    if (
      status !== "ready" ||
      summarizingHistoryRef.current ||
      conversationMessages.length < MESSAGE_LIMIT
    ) return;

    const numberToSummarize = conversationMessages.length - RECENT_MESSAGES_TO_KEEP;
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
      regenerate();
    }
  }, [pendingRegenerateAfterEdit]);

  const handleAddFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const acceptedFiles: File[] = [];
    let errorMsg = "";

    for (const file of Array.from(files)) {
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
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found && found.source === "file") URL.revokeObjectURL(found.previewUrl);
      return prev.filter((a) => a.id !== id);
    });
  }, []);

  const handleAttachExistingFile = useCallback((file: ChatFile) => {
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
  }, []);

  const handleSubmit = async () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    const text = input;
    const pending = attachments;
    setInput("");
    setAttachments([]);
    setAttachmentError("");

    if (pending.length === 0) {
      sendMessage({ text });
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

    sendMessage({ text, files });
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
      setPendingRegenerateAfterEdit(true);
    },
    [isLoading, setMessages]
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
          <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-2 sm:px-4 pt-12 sm:pt-16 pb-28 sm:pb-36">
            <div className="max-w-3xl mx-auto">
              {visibleMessages.map((message, i) => {
                const isLastAssistant = i === visibleMessages.length - 1 && message.role === "assistant";
                return (
                  <div key={message.id} data-message-id={message.id}>
                    <ChatMessage
                      message={message}
                      onRegenerate={isLastAssistant ? () => regenerate() : undefined}
                      onEdit={message.role === "user" ? handleEditMessage : undefined}
                      isStreaming={isLastAssistant && isLoading}
                      disableActions={isLoading}
                    />
                  </div>
                );
              })}
              {showTypingIndicator && <TypingIndicator />}
              {error && (
                <div className="flex gap-2.5 sm:gap-4 w-full max-w-3xl mx-auto py-3 sm:py-4">
                  <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden flex-shrink-0 mt-1">
                    <img src="/nova-logo.png" alt="NOVA" width={18} height={18} className="sm:w-[20px] sm:h-[20px]" />
                  </div>
                  <div className="flex-1 text-xs sm:text-sm leading-relaxed text-[#e87070] bg-[#1e1010] border border-[#3a1a1a] rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3">
                    Something went wrong. Please check your internet connection or try again in a moment.
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
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}