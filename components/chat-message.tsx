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
  const status = data?.status;
  const seconds = data?.seconds;
  const isThinking = status === "thinking";
  const [open, setOpen] = useState(true);

  // Auto-expand whenever a new thinking phase begins
  useEffect(() => {
    if (isThinking) {
      setOpen(true);
    }
  }, [isThinking]);

  return (
    <div
      className={cn(
        "mb-3 rounded-xl transition-all duration-300",
        isThinking ? "bg-[#141414] border border-[#2a2a2a] p-3 shadow-sm" : "bg-transparent"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-[#888] hover:text-[#bbb] transition-colors w-full text-left select-none group"
      >
        <Brain
          className={cn(
            "w-4 h-4 transition-all duration-300",
            isThinking
              ? "text-[#4a6cf7] animate-pulse scale-110"
              : "text-[#888] group-hover:text-[#bbb]"
          )}
        />
        <span className="font-medium text-[#aaa] group-hover:text-[#ddd]">
          {isThinking
            ? "Thinking…"
            : status === "error"
            ? "Thinking (unavailable)"
            : `Thought for ${seconds ?? 1} second${seconds === 1 ? "" : "s"}`}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 ml-auto transition-transform duration-200 text-[#666] group-hover:text-[#aaa]",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Thought content rendered in real-time during thinking */}
      {open && (
        <div className="mt-2.5 border-l-2 border-[#4a6cf7]/50 pl-3 text-xs text-[#999] leading-relaxed whitespace-pre-wrap animate-in fade-in slide-in-from-top-1 duration-200">
          {data?.text ? (
            <span>
              {data.text}
              {isThinking && (
                <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#4a6cf7] animate-pulse align-middle rounded-sm" />
              )}
            </span>
          ) : isThinking ? (
            <div className="flex items-center gap-2 text-[#777] italic py-1">
              <span className="w-1.5 h-1.5 bg-[#4a6cf7] rounded-full animate-ping" />
              <span>Analyzing & thinking step-by-step…</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SearchBlock({ data }: { data: any }) {
  const status = data?.status;
  const results = data?.results ?? [];
  const isSearching = status === "searching";
  const [open, setOpen] = useState(isSearching);

  useEffect(() => {
    if (isSearching) setOpen(true);
  }, [isSearching]);

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-[#888] hover:text-[#bbb] transition-colors select-none group w-full text-left"
      >
        <Search className={cn("w-3.5 h-3.5 transition-colors", isSearching ? "text-[#4a6cf7] animate-spin" : "text-[#888]")} />
        <span className="font-medium text-[#aaa] group-hover:text-[#ddd]">
          {isSearching
            ? `Searching the web for "${data?.query || "information"}"…`
            : status === "error"
            ? "Web search unavailable"
            : `Searched the web (${results.length} result${results.length === 1 ? "" : "s"})`}
        </span>
        <ChevronDown className={cn("w-3.5 h-3.5 ml-auto transition-transform duration-200 text-[#666]", open && "rotate-180")} />
      </button>
      {open && results.length > 0 && (
        <div className="mt-2 border-l-2 border-[#2a2a2a] pl-3 space-y-2 animate-in fade-in duration-200">
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
        className="max-w-[220px] max-h-[220px] rounded-lg border border-[#2a2a2a] object-cover transition-transform hover:scale-[1.02]"
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

  useEffect(() => {
    if (!isEditing) {
      setEditValue(messageText(message));
    }
  }, [message, isEditing]);

  const fileParts = message.parts.filter((p) => p.type === "file");
  const thoughtParts = message.parts.filter((p) => p.type === "data-thought").slice(-1);
  const searchParts = message.parts.filter((p) => p.type === "data-search").slice(-1);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(messageText(message));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
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
  const showActions = isUser || (!isStreaming && !disableActions);

  return (
    <div
      className={cn(
        "flex gap-4 w-full max-w-3xl mx-auto py-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar — assistant only */}
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <div className="w-8 h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden shadow-md">
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
          <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl rounded-tr-sm px-4 py-3 text-white w-full min-w-[240px] shadow-lg animate-in fade-in duration-200">
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
                className="px-3 py-1 rounded-md text-xs text-[#aaa] hover:text-white hover:bg-[#2a2a2a] transition-all duration-150 active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                className="px-3 py-1 rounded-md text-xs bg-[#4a6cf7] text-white hover:bg-[#3a5ce7] transition-all duration-150 active:scale-95 shadow-sm"
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
                ? "bg-[#1e1e1e] border border-[#2a2a2a] rounded-2xl rounded-tr-sm px-4 py-3 text-white shadow-sm"
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
                            <pre className="bg-[#111] border border-[#2a2a2a] rounded-lg p-4 overflow-x-auto my-3 shadow-inner">
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
                            className="text-[#4a6cf7] underline underline-offset-2 hover:text-[#6a8cf7] transition-colors"
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

        {/* Action row: Hidden completely while response is streaming or generating */}
        {!isEditing && showActions && (
          <div className={cn("flex items-center gap-1 text-[#666] animate-in fade-in duration-200", isUser ? "justify-end" : "justify-start")}>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90"
              aria-label="Copy message"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#4a6cf7] scale-110 transition-transform" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            {isUser && onEdit && (
              <button
                onClick={() => setIsEditing(true)}
                disabled={disableActions}
                className="p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Edit message"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}

            {!isUser && onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={disableActions}
                className="p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
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
    <div className="flex gap-4 w-full max-w-3xl mx-auto py-4 animate-in fade-in duration-300">
      <div className="w-8 h-8 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center overflow-hidden flex-shrink-0 mt-1 shadow-md">
        <Image src="/nova-logo.png" alt="NOVA" width={20} height={20} className="animate-pulse" />
      </div>
      <div className="flex items-center gap-1.5 pt-3">
        <span className="w-2 h-2 bg-[#4a6cf7] rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-2 h-2 bg-[#4a6cf7] rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-2 h-2 bg-[#4a6cf7] rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}
