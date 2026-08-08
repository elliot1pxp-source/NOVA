"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type TouchEvent, type WheelEvent } from "react";
import Image from "next/image";
import { UIMessage } from "ai";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronDown,
  Copy,
  RotateCcw,
  Pencil,
  FileText,
  Search,
  Check,
  Brain,
  X,
  FileSearch,
} from "lucide-react";

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

const SCROLL_BOTTOM_THRESHOLD = 24;

function CodeBlock({
  children,
  className,
  isStreaming = false,
}: {
  children: React.ReactNode;
  className?: string;
  isStreaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const codeContainerRef = useRef<HTMLDivElement>(null);
  const shouldFollowCodeRef = useRef(true);
  const wasStreamingRef = useRef(false);
  const codeTouchStartYRef = useRef<number | null>(null);
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";
  const codeString = String(children).replace(/\n$/, "");

  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      shouldFollowCodeRef.current = true;
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    if (!isStreaming || !shouldFollowCodeRef.current) return;

    const codeContainer = codeContainerRef.current;
    if (codeContainer) {
      codeContainer.scrollTop = codeContainer.scrollHeight;
    }
  }, [codeString, isStreaming]);

  const handleCodeScroll = () => {
    const codeContainer = codeContainerRef.current;
    if (!codeContainer) return;
    const distanceFromBottom =
      codeContainer.scrollHeight - codeContainer.scrollTop - codeContainer.clientHeight;
    shouldFollowCodeRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
  };

  const handleCodeWheel = (event: WheelEvent<HTMLDivElement>) => {
    // Pause before the next streamed update has a chance to scroll this pane.
    if (event.deltaY < 0) {
      shouldFollowCodeRef.current = false;
    }
  };

  const handleCodeTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    codeTouchStartYRef.current = event.touches[0]?.clientY ?? null;
  };

  const handleCodeTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const currentY = event.touches[0]?.clientY;
    const startY = codeTouchStartYRef.current;
    if (currentY !== undefined && startY !== null && currentY > startY) {
      shouldFollowCodeRef.current = false;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  return (
    <div className="relative my-2 sm:my-3 rounded-lg sm:rounded-xl border border-[#2a2a2a] bg-[#111115] overflow-hidden max-w-full shadow-md">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-2.5 py-1 sm:px-3 sm:py-1.5 bg-[#18181c] border-b border-[#2a2a2a] text-[11px] sm:text-xs">
        {/* Copy button on TOP LEFT */}
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 sm:gap-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md bg-[#22232b] hover:bg-[#2c2d38] text-[#ccc] hover:text-white transition-all text-[11px] sm:text-xs font-sans active:scale-95 select-none cursor-pointer"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400" />
              <span className="text-emerald-400 font-medium text-[10px] sm:text-[11px]">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#aaa]" />
              <span className="text-[10px] sm:text-[11px]">Copy code</span>
            </>
          )}
        </button>

        {/* Language Badge on TOP RIGHT */}
        <span className="font-mono text-[9px] sm:text-[10px] text-[#777] uppercase tracking-wider font-semibold">
          {language || "code"}
        </span>
      </div>

      {/* Code Container */}
      <div
        ref={codeContainerRef}
        onScroll={handleCodeScroll}
        onWheel={handleCodeWheel}
        onTouchStart={handleCodeTouchStart}
        onTouchMove={handleCodeTouchMove}
        data-code-scroll
        className="overflow-x-auto max-h-[360px] sm:max-h-[480px] overflow-y-auto p-2.5 sm:p-4 scrollbar-thin scrollbar-thumb-white/10"
      >
        <pre className="m-0 font-mono text-[11px] sm:text-xs leading-relaxed text-[#e8e8e8] whitespace-pre">
          <code className={className}>{codeString}</code>
        </pre>
      </div>
    </div>
  );
}

function createMarkdownComponents(isStreaming = false) {
  return {
  pre({ children }: any) {
    return <div className="max-w-full overflow-hidden my-1.5 sm:my-2">{children}</div>;
  },
  code({ node, inline, className, children, ...props }: any) {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = inline ?? (!match && !String(children).includes("\n"));

    if (isInline) {
      return (
        <code
          className="bg-[#2a2a2a] px-1 sm:px-1.5 py-0.5 rounded text-[#a8d8ff] text-[11px] sm:text-xs font-mono break-words"
          {...props}
        >
          {children}
        </code>
      );
    }

    return <CodeBlock className={className} isStreaming={isStreaming}>{children}</CodeBlock>;
  },
  p({ children }: any) {
    return <p className="mb-2 sm:mb-3 last:mb-0 text-[#ccc] leading-relaxed">{children}</p>;
  },
  ul({ children }: any) {
    return <ul className="list-disc pl-4 sm:pl-5 mb-2 sm:mb-3 space-y-1 text-[#ccc]">{children}</ul>;
  },
  ol({ children }: any) {
    return <ol className="list-decimal pl-4 sm:pl-5 mb-2 sm:mb-3 space-y-1 text-[#ccc]">{children}</ol>;
  },
  h1({ children }: any) {
    return <h1 className="text-lg sm:text-xl font-bold text-white mb-2 sm:mb-3 mt-3 sm:mt-4">{children}</h1>;
  },
  h2({ children }: any) {
    return <h2 className="text-base sm:text-lg font-semibold text-white mb-1.5 sm:mb-2 mt-2.5 sm:mt-3">{children}</h2>;
  },
  h3({ children }: any) {
    return <h3 className="text-sm sm:text-base font-semibold text-white mb-1.5 sm:mb-2 mt-2">{children}</h3>;
  },
  blockquote({ children }: any) {
    return (
      <blockquote className="border-l-2 border-[#4a6cf7] pl-3 sm:pl-4 my-2 sm:my-3 text-[#888] italic">
        {children}
      </blockquote>
    );
  },
  strong({ children }: any) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },
  a({ href, children }: any) {
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
  table({ children }: any) {
    return (
      <div className="overflow-x-auto my-2 sm:my-3 rounded-lg border border-[#2a2a2a]">
        <table className="w-full text-left text-[11px] sm:text-xs text-[#ccc] border-collapse min-w-full">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }: any) {
    return <thead className="bg-[#1a1a1a] text-white">{children}</thead>;
  },
  tbody({ children }: any) {
    return <tbody className="divide-y divide-[#2a2a2a]">{children}</tbody>;
  },
  tr({ children }: any) {
    return <tr className="hover:bg-[#1a1a1a]/60 transition-colors">{children}</tr>;
  },
  th({ children }: any) {
    return (
      <th className="px-2.5 sm:px-3 py-2 font-semibold text-white whitespace-nowrap border-b border-[#2a2a2a]">
        {children}
      </th>
    );
  },
  td({ children }: any) {
    return <td className="px-2.5 sm:px-3 py-2 align-top border-b border-[#2a2a2a] last:border-b-0">{children}</td>;
  },
  };
}

const markdownComponents = createMarkdownComponents();

function StreamingMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [cursorPosition, setCursorPosition] = useState<{ left: number; top: number } | null>(null);
  const streamingMarkdownComponents = useMemo(
    () => createMarkdownComponents(isStreaming),
    [isStreaming]
  );

  useLayoutEffect(() => {
    const container = contentRef.current;
    if (!isStreaming || !container) {
      setCursorPosition(null);
      return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let lastTextNode: Text | null = null;
    let currentNode = walker.nextNode();
    while (currentNode) {
      if (currentNode.textContent?.trim()) lastTextNode = currentNode as Text;
      currentNode = walker.nextNode();
    }

    if (!lastTextNode) {
      setCursorPosition(null);
      return;
    }

    const lastCharacterIndex = lastTextNode.textContent?.trimEnd().length ?? 0;
    if (lastCharacterIndex === 0) {
      setCursorPosition(null);
      return;
    }

    const range = document.createRange();
    range.setStart(lastTextNode, lastCharacterIndex - 1);
    range.setEnd(lastTextNode, lastCharacterIndex);
    const characterRect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    setCursorPosition({
      left: characterRect.right - containerRect.left + 3,
      top: characterRect.top - containerRect.top + characterRect.height / 2 - 3,
    });
  }, [isStreaming, text]);

  return (
    <div ref={contentRef} className="relative">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={streamingMarkdownComponents}>
        {text}
      </ReactMarkdown>
      {isStreaming && cursorPosition && (
        <span
          aria-hidden="true"
          className="absolute w-1.5 h-1.5 rounded-full bg-white animate-pulse pointer-events-none"
          style={{ left: cursorPosition.left, top: cursorPosition.top }}
        />
      )}
    </div>
  );
}

function ThoughtBlock({ data }: { data: any }) {
  const status = data?.status;
  const seconds = data?.seconds;
  const isThinking = status === "thinking";
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (isThinking) {
      setOpen(true);
    }
  }, [isThinking]);

  return (
    <div
      className={cn(
        "mb-2.5 sm:mb-3 rounded-xl transition-all duration-300 min-w-0 overflow-hidden",
        isThinking ? "bg-[#141414] border border-[#2a2a2a] p-2.5 sm:p-3 shadow-sm" : "bg-transparent"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-[#888] hover:text-[#bbb] transition-colors w-full text-left select-none group"
      >
        <Brain
          className={cn(
            "w-3.5 h-3.5 sm:w-4 sm:h-4 transition-all duration-300",
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
            "w-3 h-3 sm:w-3.5 sm:h-3.5 ml-auto transition-transform duration-200 text-[#666] group-hover:text-[#aaa]",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Thought content with Markdown */}
      {open && (
        <div className="mt-2 sm:mt-2.5 border-l-2 border-[#4a6cf7]/50 pl-2.5 sm:pl-3 text-[11px] sm:text-xs text-[#999] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200 min-w-0 overflow-hidden">
          {data?.text ? (
            <div className="relative prose prose-invert prose-xs max-w-none text-[#999]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {data.text}
              </ReactMarkdown>
              {isThinking && (
                <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#4a6cf7] animate-pulse align-middle rounded-sm" />
              )}
            </div>
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
  const isGenerating = status === "generating_query";
  const isSearching = status === "searching";
  const [open, setOpen] = useState(isGenerating || isSearching);

  useEffect(() => {
    if (isGenerating || isSearching) setOpen(true);
  }, [isGenerating, isSearching]);

  return (
    <div className="mb-2.5 sm:mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] sm:text-xs text-[#888] hover:text-[#bbb] transition-colors select-none group w-full text-left"
      >
        <Search
          className={cn(
            "w-3 h-3 sm:w-3.5 sm:h-3.5 transition-all duration-300",
            isGenerating
              ? "text-[#4a6cf7] animate-pulse"
              : isSearching
              ? "text-[#4a6cf7] animate-spin"
              : "text-[#888]"
          )}
        />
        <span className="font-medium text-[#aaa] group-hover:text-[#ddd]">
          {isGenerating
            ? "Generating search query…"
            : isSearching
            ? `Searching web for "${data?.query || "information"}"…`
            : status === "error"
            ? "Web search unavailable"
            : `Searched web (${results.length} result${results.length === 1 ? "" : "s"})`}
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 sm:w-3.5 sm:h-3.5 ml-auto transition-transform duration-200 text-[#666]",
            open && "rotate-180"
          )}
        />
      </button>
      {open && results.length > 0 && (
        <div className="mt-1.5 sm:mt-2 border-l-2 border-[#2a2a2a] pl-2.5 sm:pl-3 space-y-1.5 sm:space-y-2 animate-in fade-in duration-200">
          {results.map((r: any, i: number) => (
            <div key={i} className="text-[11px] sm:text-xs">
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function FileScanBlock({ parts, isStreaming }: { parts: any[]; isStreaming?: boolean }) {
  // Derive the full file chain state from all accumulated data-file parts.
  // Each event has a unique id so they all accumulate in message.parts.
  const { files, total, hasError, isDone } = useMemo(() => {
    let total = 0;
    let isDone = false;
    const fileMap = new Map<number, { name: string; status: string }>();

    for (const part of parts) {
      const d = part.data;
      if (!d) continue;
      if (typeof d.total === "number") total = d.total;
      if (d.status === "done") isDone = true;
      if (d.filename && typeof d.index === "number") {
        fileMap.set(d.index, { name: d.filename, status: d.status });
      }
    }

    const files = Array.from({ length: total }, (_, i) => {
      const state = fileMap.get(i);
      return { name: state?.name ?? `File ${i + 1}`, status: state?.status ?? "pending" };
    });

    const hasError = parts.some((p) => p.data?.status === "error");

    return { files, total, hasError, isDone };
  }, [parts]);

  if (total === 0) return null;

  // The scan is "active" while streaming AND the final "done" event hasn't
  // arrived yet. Once done (or the stream finished), animations freeze.
  const isScanning = isStreaming && !isDone && !hasError;
  const isComplete = !isScanning && !hasError && (isDone || !isStreaming);

  const readingIndex = files.findIndex((f) => f.status === "reading");
  const doneCount = files.filter((f) => f.status === "analyzed").length;
  const activeName =
    readingIndex >= 0 ? files[readingIndex].name : doneCount < total ? "files" : "";
  const percent = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div className="mb-2.5 sm:mb-3 rounded-xl bg-[#141414] border border-[#2a2a2a] p-2.5 sm:p-3 shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-1.5 text-[11px] sm:text-xs select-none">
        <FileSearch
          className={cn(
            "w-3.5 h-3.5 sm:w-4 sm:h-4 transition-all duration-300",
            isComplete
              ? "text-[#22c55e]"
              : hasError
                ? "text-red-400"
                : "text-[#4a6cf7] animate-pulse"
          )}
        />
        <span className="font-medium text-[#aaa]">
          {isComplete
            ? `Analyzed: ${total} file${total === 1 ? "" : "s"}`
            : hasError
              ? "File analysis failed"
              : activeName
                ? `Analyzing: ${activeName} (${doneCount + 1}/${total})…`
                : `Preparing to analyze: ${total} file${total === 1 ? "" : "s"}…`}
        </span>
        {isScanning && (
          <span className="ml-auto flex gap-1">
            <span className="w-1 h-1 rounded-full bg-[#4a6cf7] animate-pulse [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-[#4a6cf7] animate-pulse [animation-delay:200ms]" />
            <span className="w-1 h-1 rounded-full bg-[#4a6cf7] animate-pulse [animation-delay:400ms]" />
          </span>
        )}
      </div>

      {/* Animated chain */}
      <div className="flex items-center mt-2 overflow-x-auto pb-1 no-scrollbar">
        {files.map((file, i) => {
          const isReading = file.status === "reading";
          const isDoneFile = file.status === "analyzed";
          const isFailed = file.status === "error";
          const isPending = file.status === "pending";

          return (
            <div key={i} className="flex items-center shrink-0">
              {/* File chip */}
              <div
                className={cn(
                  "flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] sm:text-[11px] border transition-all duration-300 whitespace-nowrap",
                  isReading && isScanning
                    ? "bg-[#4a6cf7]/15 border-[#4a6cf7]/50 text-[#7a8cff] file-scan-chip-active"
                    : isReading
                      ? "bg-[#4a6cf7]/15 border-[#4a6cf7]/50 text-[#7a8cff]"
                      : isDoneFile
                        ? "bg-[#22c55e]/10 border-[#22c55e]/40 text-[#22c55e]"
                        : isFailed
                          ? "bg-red-500/10 border-red-500/40 text-red-400"
                          : "bg-white/5 border-white/10 text-[#555]"
                )}
              >
                {isReading && <span className="w-1.5 h-1.5 rounded-full bg-[#4a6cf7] animate-pulse" />}
                {isDoneFile && <Check className="w-3 h-3" />}
                {isFailed && <X className="w-3 h-3" />}
                {isPending && <span className="w-1.5 h-1.5 rounded-full bg-[#555]" />}
                <span className="truncate max-w-[110px]">{file.name}</span>
              </div>

              {/* Chain link */}
              {i < files.length - 1 && (
                <div
                  className={cn(
                    "w-4 h-[2px] shrink-0 rounded-full transition-colors duration-300",
                    isScanning
                      ? "bg-[#4a6cf7]/30"
                      : isDoneFile || isDone
                        ? "bg-[#22c55e]/40"
                        : isFailed
                          ? "bg-red-500/40"
                          : "bg-white/10"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {isScanning && (
        <div className="mt-2.5">
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#4a6cf7] to-[#7a8cff] transition-all duration-500 ease-out"
              style={{ width: `${Math.max(percent, doneCount > 0 ? 8 : 0)}%` }}
            />
          </div>
          <div className="mt-1 text-right text-[10px] text-[#666]">
            {percent}% complete
          </div>
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
        className="max-w-[160px] max-h-[160px] sm:max-w-[220px] sm:max-h-[220px] rounded-lg border border-[#2a2a2a] object-cover transition-transform hover:scale-[1.02]"
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 bg-[#111] border border-[#2a2a2a] rounded-lg px-2.5 py-1.5 sm:px-3 sm:py-2 text-[11px] sm:text-xs text-[#ccc]">
      <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#888]" />
      <span className="truncate max-w-[120px] sm:max-w-[160px]">{part.filename || "file"}</span>
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
  const scanParts = message.parts.filter((p) => p.type === "data-file");
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

  const showActions = isUser || (!isStreaming && !disableActions);

  return (
    <div
      data-chat-message
      className={cn(
        "flex gap-2.5 sm:gap-4 w-full max-w-3xl mx-auto py-2.5 sm:py-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      {/* Avatar — assistant only */}
      {!isUser && (
        <div className="flex-shrink-0 mt-0.5 sm:mt-1">
          <Image src="/nova-logo.png" alt="NOVA" width={24} height={24} className="w-6 h-6 sm:w-[30px] sm:h-[30px] rounded-md sm:rounded-lg" />
        </div>
      )}

      {/* Content */}
      <div className={cn("flex flex-col gap-1.5 sm:gap-2 min-w-0", isUser ? "items-end max-w-[85%] sm:max-w-[80%] ml-auto" : "flex-1")}>
        {fileParts.length > 0 && (
          <div className={cn("flex flex-wrap gap-1.5 sm:gap-2", isUser && "justify-end")}>
            {fileParts.map((part, i) => (
              <Attachment key={i} part={part} />
            ))}
          </div>
        )}

        {!isUser && scanParts.length > 0 && (
          <FileScanBlock parts={scanParts} isStreaming={Boolean(isStreaming)} />
        )}
        {!isUser && searchParts.map((p, i) => <SearchBlock key={`s-${i}`} data={(p as any).data} />)}
        {!isUser && thoughtParts.map((p, i) => <ThoughtBlock key={`t-${i}`} data={(p as any).data} />)}

        {isUser && isEditing ? (
          <div className="bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl sm:rounded-2xl rounded-tr-sm px-3 py-2 sm:px-4 sm:py-3 text-white w-full min-w-[200px] sm:min-w-[240px] shadow-lg animate-in fade-in duration-200">
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
              className="w-full bg-transparent text-xs sm:text-sm leading-relaxed text-white resize-none focus:outline-none"
            />
            <div className="flex items-center justify-end gap-1.5 sm:gap-2 mt-2">
              <button
                onClick={handleEditCancel}
                className="px-2.5 py-1 rounded-md text-[11px] sm:text-xs text-[#aaa] hover:text-white hover:bg-[#2a2a2a] transition-all duration-150 active:scale-95"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                className="px-2.5 py-1 rounded-md text-[11px] sm:text-xs bg-[#4a6cf7] text-white hover:bg-[#3a5ce7] transition-all duration-150 active:scale-95 shadow-sm"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div
            className={cn(
              "text-xs sm:text-sm leading-relaxed min-w-0 w-full",
              isUser
                ? "bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl sm:rounded-2xl rounded-tr-sm px-3.5 py-2.5 sm:px-4 sm:py-3 text-white shadow-sm overflow-hidden"
                : "text-[#ddd] prose prose-invert prose-xs sm:prose-sm max-w-none overflow-visible"
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
                  <StreamingMarkdown
                    key={index}
                    text={part.text}
                    isStreaming={Boolean(isStreaming)}
                  />
                );
              }
              return null;
            })}
          </div>
        )}

        {/* Action row */}
        {!isEditing && showActions && (
          <div className={cn("flex items-center gap-1 text-[#666] animate-in fade-in duration-200", isUser ? "justify-end" : "justify-start")}>
            <button
              onClick={handleCopy}
              className="p-1 sm:p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90"
              aria-label="Copy message"
            >
              {copied ? <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#4a6cf7] scale-110 transition-transform" /> : <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
            </button>

            {isUser && onEdit && (
              <button
                onClick={() => setIsEditing(true)}
                disabled={disableActions}
                className="p-1 sm:p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Edit message"
              >
                <Pencil className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              </button>
            )}

            {!isUser && onRegenerate && (
              <button
                onClick={onRegenerate}
                disabled={disableActions}
                className="p-1 sm:p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                aria-label="Regenerate response"
              >
                <RotateCcw className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
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
    <div className="flex w-full max-w-3xl mx-auto mt-1 sm:mt-2 py-1 animate-in fade-in duration-300">
      <div className="flex items-center gap-1 py-1">
        <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}
