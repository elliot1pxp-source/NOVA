"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { UIMessage } from "ai";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import { ChevronDown, Copy, RotateCcw, Pencil, FileText, Search, Check, Brain } from "lucide-react";

type Props = {
  message: UIMessage;
  onRegenerate?: () => void;
  onEdit?: (messageId: string, newText: string) => void;
  /** true while this specific assistant message is still being generated */
  isStreaming?: boolean;
  /** true while any response is in flight (disables edit/retry to avoid overlap) */
  disableActions?: boolean;
};

function messageText(message: UIMessage) {
  return message.parts
  .filter((p): p is { type: "text"; text: string } => p.type === "text")
  .map((p) => p.text)
  .join("");
}

function ThoughtBlock({ data }: { data: any }) {
  const [open, setOpen] = useState(false);
  const status = data?.status;
  const seconds = data?.seconds;

  return (
    <div className="mb-3">
    <button
    onClick={() => setOpen((o) => !o)}
    className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#bbb] transition-colors"
    >
    <Brain className="w-3.5 h-3.5" />
    <span>
    {status === "thinking"
      ? "Thinking…"
      : status === "error"
      ? "Thinking (unavailable)"
      : `Thought for ${seconds ?? 1} second${seconds === 1 ? "" : "s"}`}
      </span>
      {status !== "thinking" && (
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      )}
      </button>
      {open && data?.text && (
        <div className="mt-2 border-l-2 border-[#2a2a2a] pl-3 text-xs text-[#888] leading-relaxed whitespace-pre-wrap">
        {data.text}
        </div>
      )}
      </div>
  );
}

function SearchBlock({ data }: { data: any }) {
  const [open, setOpen] = useState(false);
  const status = data?.status;
  const results = data?.results ?? [];

  return (
    <div className="mb-3">
    <button
    onClick={() => setOpen((o) => !o)}
    className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#bbb] transition-colors"
    >
    <Search className="w-3.5 h-3.5" />
    <span>
    {status === "searching"
      ? `Searching the web for "${data?.query}"…`
      : status === "error"
      ? "Web search unavailable"
      : `Searched the web (${results.length} result${results.length === 1 ? "" : "s"})`}
      </span>
      {status === "done" && (
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      )}
      </button>
      {open && results.length > 0 && (
        <div className="mt-2 border-l-2 border-[#2a2a2a] pl-3 space-y-2">
        {results.map((r: any, i: number) => (
          <div key={i} className="text-xs">
          {r.url ? (
            <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4a6cf7] hover:underline"
            >
            [{i + 1}] {r.title}
            </a>
          ) : (
            <span className="text-[#aaa] font-medium">
            [{i + 1}] {r.title}
            </span>
          )}
          <p className="text-[#777] mt-0.5">{r.snippet}</p>
          </div>
        ))}
        </div>
      )}
      </div>
  );
}

function Attachment({ part }: { part: any }) {
  const isImage = typeof part.mediaType === "string" && part.mediaType.startsWith("image/");
  if (isImage) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
      src={part.url}
      alt={part.filename || "attachment"}
      className="max-w-[220px] max-h-[220px] rounded-lg border border-[#2a2a2a] object-cover"
      />
    );
  }
  return (
    <div className="flex items-center gap-2 bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-[#ccc]">
    <FileText className="w-4 h-4 text-[#888]" />
    <span className="truncate max-w-[160px]">{part.filename || "file"}</span>
    </div>
  );
}

export function ChatMessage({ message, onRegenerate, onEdit, isStreaming, disableActions }: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(() => messageText(message));

  // Keep the edit draft in sync with the message content when not actively editing
  useEffect(() => {
    if (!isEditing) {
      setEditValue(messageText(message));
    }
  }, [message, isEditing]);

  const fileParts = message.parts.filter((p) => p.type === "file");
  // Data stream updates may be replayed by a reconnect or a stale client. The
  // latest state is authoritative, so render it once even if an older status
  // part remains in the message.
  const thoughtParts = message.parts.filter((p) => p.type === "data-thought").slice(-1);
  const searchParts = message.parts.filter((p) => p.type === "data-search").slice(-1);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageText(message));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  const handleEditSave = () => {
    const trimmed = editValue.trim();
    if (!trimmed) return;
    setIsEditing(false);
    onEdit?.(message.id, trimmed);
  };

  const handleEditCancel = () => {
    setEditValue(messageText(message));
    setIsEditing(false);
  };

  // AI replies only show their actions (copy/retry) once fully finished.
  // User messages always show their actions (copy/edit).
  const showActions = isUser || !isStreaming;

  return (
    <div
    className={cn(
      "flex gap-4 w-full max-w-3xl mx-auto py-4",
      isUser ? "flex-row-reverse" : "flex-row"
    )}
    >
    {/* Avatar — assistant only, user messages no longer show an avatar */}
    {!isUser && (
      <div className="flex-shrink-0 mt-1">
      <div className="w-8 h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden">
      <Image src="/nova-logo.png" alt="NOVA" width={20} height={20} />
      </div>
      </div>
    )}

    {/* Content */}
    <div className={cn("flex flex-col gap-2", isUser ? "items-end max-w-[80%] ml-auto" : "flex-1")}>
    {fileParts.length > 0 && (
      <div className={cn("flex flex-wrap gap-2", isUser && "justify-end")}>
      {fileParts.map((part, i) => (
        <Attachment key={i} part={part} />
      ))}
      </div>
    )}

    {!isUser && thoughtParts.map((p, i) => <ThoughtBlock key={`t-${i}`} data={(p as any).data} />)}
    {!isUser && searchParts.map((p, i) => <SearchBlock key={`s-${i}`} data={(p as any).data} />)}

    {isUser && isEditing ? (
      <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl rounded-tr-sm px-4 py-3 text-white w-full min-w-[240px]">
      <textarea
      autoFocus
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          handleEditSave();
        }
        if (e.key === "Escape") {
          handleEditCancel();
        }
      }}
      rows={Math.min(10, Math.max(2, editValue.split("\n").length))}
      className="w-full bg-transparent text-sm leading-relaxed text-white resize-none focus:outline-none"
      />
      <div className="flex items-center justify-end gap-2 mt-2">
      <button
      onClick={handleEditCancel}
      className="px-3 py-1 rounded-md text-xs text-[#aaa] hover:text-white hover:bg-[#2a2a2a] transition-colors"
      >
      Cancel
      </button>
      <button
      onClick={handleEditSave}
      className="px-3 py-1 rounded-md text-xs bg-[#4a6cf7] text-white hover:bg-[#3a5ce7] transition-colors"
      >
      Save
      </button>
      </div>
      </div>
    ) : (
      <div
      className={cn(
        "text-sm leading-relaxed",
        isUser
        ? "bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl rounded-tr-sm px-4 py-3 text-white"
        : "text-[#ddd] prose prose-invert prose-sm max-w-none"
      )}
      >
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          if (isUser) {
            return (
              <span key={index} className="whitespace-pre-wrap">
              {part.text}
              </span>
            );
          }
          return (
            <ReactMarkdown
            key={index}
            components={{
              code({ className, children, ...props }) {
                const isBlock = className?.includes("language-");
                if (isBlock) {
                  return (
                    <pre className="bg-[#111] border border-[#2a2a2a] rounded-lg p-4 overflow-x-auto my-3">
                    <code className={cn("text-[#e8e8e8] text-xs font-mono", className)} {...props}>
                    {children}
                    </code>
                    </pre>
                  );
                }
                return (
                  <code className="bg-[#2a2a2a] px-1.5 py-0.5 rounded text-[#a8d8ff] text-xs font-mono" {...props}>
                  {children}
                  </code>
                );
              },
              p({ children }) {
                return <p className="mb-3 last:mb-0 text-[#ccc]">{children}</p>;
              },
              ul({ children }) {
                return <ul className="list-disc pl-5 mb-3 space-y-1 text-[#ccc]">{children}</ul>;
              },
              ol({ children }) {
                return <ol className="list-decimal pl-5 mb-3 space-y-1 text-[#ccc]">{children}</ol>;
              },
              h1({ children }) {
                return <h1 className="text-xl font-bold text-white mb-3">{children}</h1>;
              },
              h2({ children }) {
                return <h2 className="text-lg font-semibold text-white mb-2">{children}</h2>;
              },
              h3({ children }) {
                return <h3 className="text-base font-semibold text-white mb-2">{children}</h3>;
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-2 border-[#4a6cf7] pl-4 my-3 text-[#888] italic">
                  {children}
                  </blockquote>
                );
              },
              strong({ children }) {
                return <strong className="font-semibold text-white">{children}</strong>;
              },
              a({ href, children }) {
                return (
                  <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#4a6cf7] underline underline-offset-2 hover:text-[#6a8cf7]"
                  >
                  {children}
                  </a>
                );
              },
            }}
            >
            {part.text}
            </ReactMarkdown>
          );
        }
        return null;
      })}
      </div>
    )}

    {/* Action row: copy for everyone, edit for user, retry for AI — hidden while the AI reply is still streaming */}
    {!isEditing && showActions && (
      <div className={cn("flex items-center gap-1 text-[#666]", isUser ? "justify-end" : "justify-start")}>
      <button
      onClick={handleCopy}
      className="p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-colors"
      aria-label="Copy message"
      >
      {copied ? <Check className="w-3.5 h-3.5 text-[#4a6cf7]" /> : <Copy className="w-3.5 h-3.5" />}
      </button>

      {isUser && onEdit && (
        <button
        onClick={() => setIsEditing(true)}
        disabled={disableActions}
        className="p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        aria-label="Edit message"
        >
        <Pencil className="w-3.5 h-3.5" />
        </button>
      )}

      {!isUser && onRegenerate && (
        <button
        onClick={onRegenerate}
        disabled={disableActions}
        className="p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-colors disabled:opacity-40 disabled:pointer-events-none"
        aria-label="Regenerate response"
        >
        <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
      </div>
    )}
    </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex gap-4 w-full max-w-3xl mx-auto py-4">
    <div className="w-8 h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden flex-shrink-0 mt-1">
    <Image src="/nova-logo.png" alt="NOVA" width={20} height={20} />
    </div>
    <div className="flex items-center gap-1.5 pt-3">
    <span className="w-1.5 h-1.5 bg-[#4a6cf7] rounded-full animate-bounce [animation-delay:0ms]" />
    <span className="w-1.5 h-1.5 bg-[#4a6cf7] rounded-full animate-bounce [animation-delay:150ms]" />
    <span className="w-1.5 h-1.5 bg-[#4a6cf7] rounded-full animate-bounce [animation-delay:300ms]" />
    </div>
    </div>
  );
}
