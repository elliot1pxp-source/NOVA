"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Image from "next/image";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Zap, Shield } from "lucide-react";
import { ChatInput, PendingAttachment } from "./chat-input";
import { ChatMessage, TypingIndicator } from "./chat-message";
import { cn } from "@/lib/utils";
import { loadMessages, saveMessages, ModelParams } from "@/lib/storage";
import { getSupportedAttachmentMimeType, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";

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
  { id: "instant", label: "Instant", icon: <Zap className="w-3.5 h-3.5" /> },
{ id: "expert", label: "Expert", icon: <Shield className="w-3.5 h-3.5" /> },
];

function generateAttachmentId() {
  return Math.random().toString(36).slice(2, 10);
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
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
  const notifiedRef = useRef(false);
  const summarizingHistoryRef = useRef(false);
  const [input, setInput] = useState("");
  const [deepThink, setDeepThink] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [pendingRegenerateAfterEdit, setPendingRegenerateAfterEdit] = useState(false);

  const initialMessages = useRef(loadMessages(chatId)).current;

  const { messages, sendMessage, status, error, regenerate, setMessages } = useChat({
  id: chatId,
  messages: initialMessages as never,
  transport: new DefaultChatTransport({
    api: "/api/chat",
    body: () => ({ model, deepThink, webSearch, modelSettings }),
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

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  // Persist messages for this chat locally (no login, no backend)
  useEffect(() => {
    if (messages.length > 0) {
      saveMessages(chatId, messages as unknown[]);
    }
  }, [messages, chatId]);

  // Once a conversation reaches 50 messages, compact its oldest four into a
  // private system summary and retain the most recent 46 turns. The updater
  // keeps any messages that arrive while the background request is running.
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
      .catch(() => {
        // Retain the complete history if background compaction fails.
      })
      .finally(() => {
        summarizingHistoryRef.current = false;
      });
  }, [messages, model, setMessages, status]);

  // Notify parent about first message for sidebar title
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

  // After an edited user message truncates the conversation, ask for a
  // fresh assistant response. This runs in an effect (rather than right
  // after setMessages) so it fires only once the hook's own state has
  // actually caught up with the edit.
  useEffect(() => {
    if (pendingRegenerateAfterEdit) {
      setPendingRegenerateAfterEdit(false);
      regenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRegenerateAfterEdit]);

  const handleAddFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const acceptedFiles = Array.from(files).filter((file) =>
      getSupportedAttachmentMimeType({ mimeType: file.type, filename: file.name })
    );
    const rejectedCount = files.length - acceptedFiles.length;
    setAttachmentError(
      rejectedCount > 0
        ? `Unsupported file type. ${SUPPORTED_ATTACHMENT_DESCRIPTION}`
        : ""
    );
    const next: PendingAttachment[] = acceptedFiles.map((file) => ({
      id: generateAttachmentId(),
                                                                       file,
                                                                       previewUrl: URL.createObjectURL(file),
    }));
    setAttachments((prev) => [...prev, ...next]);
  }, []);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const found = prev.find((a) => a.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((a) => a.id !== id);
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
        const mediaType =
          getSupportedAttachmentMimeType({ mimeType: att.file.type, filename: att.file.name }) ??
          "application/octet-stream";

        const normalizedFile =
          att.file.type === mediaType ? att.file : new Blob([att.file], { type: mediaType });

        return {
          type: "file" as const,
          url: await fileToDataUrl(normalizedFile),
          mediaType,
          filename: att.file.name,
        };
      })
    );

    sendMessage({ text, files });
  };

  // Editing a user message: swap its text, drop everything that came after
  // it (the conversation now branches from here), then regenerate the AI
  // reply based on the edited message.
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
    <div className="flex flex-col h-full w-full bg-[#0d0d0d]">
    {/* Empty state / Welcome */}
    {isEmpty ? (
      <div className="flex flex-col flex-1 items-center justify-center gap-8 px-4">
      {/* Logo + title */}
      <div className="flex items-center gap-3">
      <Image src="/nova-logo.png" alt="NOVA" width={40} height={40} className="rounded-xl" />
      <h1 className="text-2xl font-semibold text-white">Start chatting with NOVA</h1>
      </div>

      {/* Model tabs */}
      <div className="flex items-center gap-1 bg-[#111] border border-[#1e1e1e] rounded-full p-1">
      {MODEL_TABS.map((tab) => (
        <button
        key={tab.id}
        onClick={() => onModelChange(tab.id)}
        className={cn(
          "flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all",
          model === tab.id
          ? "bg-[#1e2a4a] text-[#4a6cf7] border border-[#4a6cf7]/30"
          : "text-[#666] hover:text-[#aaa]"
        )}
        >
        {tab.icon}
        {tab.label}
        </button>
      ))}
      </div>

      {/* Input */}
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
      />
      </div>
      </div>
    ) : (
      <>
      {/* Model switcher bar (compact, shown when chatting) */}
      <div className="flex justify-center pt-4 pb-2">
      <div className="flex items-center gap-1 bg-[#111] border border-[#1e1e1e] rounded-full p-0.5">
      {MODEL_TABS.map((tab) => (
        <button
        key={tab.id}
        onClick={() => onModelChange(tab.id)}
        className={cn(
          "flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
          model === tab.id
          ? "bg-[#1e2a4a] text-[#4a6cf7]"
          : "text-[#555] hover:text-[#aaa]"
        )}
        >
        {tab.icon}
        {tab.label}
        </button>
      ))}
      </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4">
        <div className="max-w-3xl mx-auto">
          {visibleMessages.map((message, i) => {
            const isLastAssistant = i === visibleMessages.length - 1 && message.role === "assistant";
            return (
              <ChatMessage
                key={message.id}
                message={message}
                onRegenerate={isLastAssistant ? () => regenerate() : undefined}
                onEdit={message.role === "user" ? handleEditMessage : undefined}
                isStreaming={isLastAssistant && isLoading}
                disableActions={isLoading}
              />
            );
          })}
          {showTypingIndicator && <TypingIndicator />}
      {error && (
        <div className="flex gap-4 w-full max-w-3xl mx-auto py-4">
        <div className="w-8 h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden flex-shrink-0 mt-1">
        <img src="/nova-logo.png" alt="NOVA" width={20} height={20} />
        </div>
        <div className="flex-1 text-sm leading-relaxed text-[#e87070] bg-[#1e1010] border border-[#3a1a1a] rounded-xl px-4 py-3">
        Something went wrong. Please check your API quota or try again in a moment.
        </div>
        </div>
      )}
      <div ref={bottomRef} />
      </div>
      </div>

      {/* Input */}
      <div className="px-4 pb-6 pt-3">
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
      />
      </div>
      </>
    )}
    </div>
  );
}
