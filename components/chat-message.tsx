"use client";

import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent,
  type WheelEvent,
} from "react";
import Image from "next/image";
import { UIMessage } from "ai";
import { cn } from "@/lib/utils";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { NeuralNetworkDiagram } from "@/components/neural-network-diagram";
import { ChatFlowDiagram } from "@/components/chat-flow-diagram";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
  /** how this reply was interrupted:
      - "text": stopped/cut off mid-answer — red "You stopped the response"
        hint next to the retry button. The Continue flow was removed. */
  interrupted?: "text";
  /** true while any response is in flight (disables edit/retry to avoid overlap) */
  disableActions?: boolean;
  /** false for messages already present when the chat loaded, so history doesn't replay its entrance animation */
  animateIn?: boolean;
  /** edit/regenerate version info — when present with total > 1, renders the < n / m > branch switcher */
  branchInfo?: { current: number; total: number };
  /** navigate between edit/regenerate versions */
  onBranchNav?: (direction: "prev" | "next") => void;
};

function messageText(message: UIMessage) {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/**
 * Throttles a fast-changing value (e.g. a streaming message that updates every
 * ~30ms) so the expensive render that depends on it only runs at most once per
 * `intervalMs`. Without this, a large streaming reply with many code blocks
 * re-renders its entire markdown tree on every chunk, and the resulting render
 * storm trips React's "Maximum update depth exceeded" guard (#185) mid-
 * generation. When `active` is false the value is passed through verbatim so
 * non-streaming renders (edit/copy/regenerate) always see the exact latest.
 */
function useThrottledValue<T>(value: T, active: boolean, intervalMs = 200): T {
  const [displayed, setDisplayed] = useState<T>(value);
  const latestRef = useRef(value);
  const lastEmitRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  latestRef.current = value;

  useEffect(() => {
    if (!active) {
      setDisplayed(value);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastEmitRef.current;

    if (elapsed >= intervalMs) {
      lastEmitRef.current = now;
      setDisplayed(value);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        lastEmitRef.current = Date.now();
        setDisplayed(latestRef.current);
      }, intervalMs - elapsed);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, active, intervalMs]);

  return displayed;
}

const SCROLL_BOTTOM_THRESHOLD = 24;

// Streaming state flows through context (instead of being baked into the
// per-stream components object) so the components map can be created once and
// memoized segments never re-parse when the stream starts/stops.
// Exported so child components (e.g. MermaidDiagram) can read the same flag.
export const StreamingContext = createContext(false);

// Citation results (from the web-search tool) flow through context for the
// same reason: markdownComponents is built once at module scope, so the `a`
// renderer can't take the current message's results as a prop. Keyed by
// citation number (1-based, matching the "[1]", "[2]"… markers the model is
// instructed to emit).
type CitationEntry = { url?: string; title?: string };
const CitationsContext = createContext<Record<number, CitationEntry>>({});

// Turns a bare "[2]" citation marker in the model's raw markdown into a real
// link the `a` component below can recognize, without disturbing genuine
// markdown links ("[text](url)") or reference-style definitions. Runs before
// the text is handed to react-markdown, so it only ever sees valid syntax.
// Skips fenced/inline code so citation-shaped text inside a code sample is
// never rewritten.
const CITATION_MARKER = /\[(\d{1,3})\](?!\()/g;
function linkifyCitations(text: string): string {
  if (!text.includes("[")) return text;
  const chunks = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return chunks
    .map((chunk, i) =>
      // Odd indices are the code chunks captured by the split regex above —
      // leave those untouched.
      i % 2 === 1 ? chunk : chunk.replace(CITATION_MARKER, (_m, n) => `[[${n}]](#cite-${n})`)
    )
    .join("");
}

function CodeBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  const isStreaming = useContext(StreamingContext);
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

function createMarkdownComponents() {
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

    // Render visual diagrams for language-diagram-* code blocks
    if (match) {
      const lang = match[1];
      if (lang === "diagram" || lang === "diagram-nn") {
        return <NeuralNetworkDiagram />;
      }
      if (lang === "diagram-chat-flow" || lang === "diagram-flow") {
        return <ChatFlowDiagram />;
      }
      if (lang === "mermaid") {
        return <MermaidDiagram code={String(children).replace(/\n$/, "")} />;
      }
    }

    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  p({ children }: any) {
    // No `last:mb-0` — the message is rendered as several adjacent markdown
    // trees (segments), and a zeroed bottom margin on the last paragraph of a
    // tree would collapse the paragraph spacing at every segment seam.
    return <p className="mb-2 sm:mb-3 text-[#ccc] leading-relaxed">{children}</p>;
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
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const citations = useContext(CitationsContext);
    const citationMatch = typeof href === "string" && href.match(/^#cite-(\d+)$/);

    if (citationMatch) {
      const num = Number(citationMatch[1]);
      const result = citations[num];

      if (result?.url) {
        return (
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            title={result.title}
            className="inline-flex items-center justify-center align-super mx-0.5 h-3.5 min-w-[1.1rem] px-1 rounded-full bg-[#4a6cf7]/15 text-[#7a9bff] text-[9px] sm:text-[10px] font-medium leading-none no-underline hover:bg-[#4a6cf7]/30 hover:text-white transition-colors"
          >
            {num}
          </a>
        );
      }

      // Model emitted a citation before results are known (or the number
      // doesn't match anything returned) — show it as plain text instead of
      // a dead link.
      return (
        <span className="inline-flex items-center justify-center align-super mx-0.5 h-3.5 min-w-[1.1rem] px-1 rounded-full bg-white/5 text-[#777] text-[9px] sm:text-[10px] font-medium leading-none">
          {num}
        </span>
      );
    }

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

// Static for the lifetime of the module — CodeBlock reads the streaming flag
// from context, so this map never needs to change and memoized segments never
// re-parse when a stream starts or stops.
const markdownComponents = createMarkdownComponents();

// ---------------------------------------------------------------------------
// Incremental markdown rendering
//
// react-markdown re-parses its whole input synchronously on the main thread
// and memoizes nothing internally. Streaming a long answer into a single
// <ReactMarkdown> therefore re-runs a full micromark parse on every stream
// chunk — with a lot of context that freezes the page.
//
// Instead the message is split into fence-aware segments of a bounded size,
// each rendered by its own memoized <ReactMarkdown>. Only the segment that
// actually grew is re-parsed per chunk; older segments are never touched
// again. While streaming, the last ~1k chars are kept as a small markdown
// tail so the parse work per chunk stays constant no matter how long the
// message becomes.
// ---------------------------------------------------------------------------

// Maximum size of one settled markdown segment.
const MARKDOWN_SEGMENT_CHARS = 1400;
// While streaming, keep roughly this many trailing chars out of the settled
// segments (they render as a small markdown tail instead).
const MARKDOWN_TAIL_TARGET = 1000;

const FENCE_LINE = /^(`{3,}|~{3,})/;

function isFenceLine(line: string) {
  return FENCE_LINE.test(line.trimStart());
}

function countFenceLines(text: string) {
  let count = 0;
  for (const line of text.split("\n")) {
    if (isFenceLine(line)) count++;
  }
  return count;
}

// Split `text` into segments of at most MARKDOWN_SEGMENT_CHARS, breaking at
// line boundaries and never inside a ``` code fence (a fence opener starts a
// fresh segment, so every fence lives in exactly one segment).
function splitMarkdownSegments(text: string): string[] {
  if (text.length <= MARKDOWN_SEGMENT_CHARS) return [text];

  const lines = text.split("\n");
  const segments: string[] = [];
  let buffer = "";
  let bufferLen = 0;
  let inFence = false;

  const flush = () => {
    if (buffer.length > 0) {
      segments.push(buffer);
      buffer = "";
      bufferLen = 0;
    }
  };

  const addLine = (line: string, withNewline: boolean) => {
    const len = line.length + (withNewline ? 1 : 0);
    if (!inFence && bufferLen > 0 && bufferLen + len > MARKDOWN_SEGMENT_CHARS) {
      flush();
    }
    buffer += line + (withNewline ? "\n" : "");
    bufferLen += len;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const withNewline = i < lines.length - 1;
    const isFence = isFenceLine(line);

    if (isFence) {
      addLine(line, withNewline);
      inFence = !inFence;
      continue;
    }

    if (inFence || line.length <= MARKDOWN_SEGMENT_CHARS * 2) {
      addLine(line, withNewline);
      continue;
    }

    // Pathological over-long line outside a fence: hard-split at whitespace so
    // a wall of text can't pin the whole message to the streaming tail forever.
    flush();
    let rest = line;
    while (rest.length > MARKDOWN_SEGMENT_CHARS) {
      const space = rest.lastIndexOf(" ", MARKDOWN_SEGMENT_CHARS);
      const at = space > MARKDOWN_SEGMENT_CHARS / 2 ? space : MARKDOWN_SEGMENT_CHARS;
      buffer += rest.slice(0, at) + "\n";
      flush();
      rest = rest.slice(at);
    }
    if (rest.length > 0) addLine(rest, withNewline);
  }

  flush();
  return segments;
}

// One settled segment — memoized on its exact text, so a segment is parsed
// once and never again, no matter how many times the message above it
// re-renders.
const MarkdownSegment = memo(function MarkdownSegment({
  text,
  components,
}: {
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components: any;
}) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
});

const StreamingMarkdown = memo(
  function StreamingMarkdown({
    text,
    isStreaming,
  }: {
    text: string;
    isStreaming: boolean;
  }) {
  // Fully derived from props (no state, no effects — nothing to sync after
  // paint, so streaming can't double-render or fall behind).
  const { segments, tail, tailIsPlainText } = useMemo(() => {
    const all = splitMarkdownSegments(text);

    if (!isStreaming) {
      return { segments: all, tail: "", tailIsPlainText: false };
    }

    // Short messages render fully as markdown (the parse is bounded); once the
    // message is long enough, keep the trailing ~TAIL_TARGET chars as a
    // separate tail so a chunk only ever re-parses the segment that grew.
    let end = 0;
    let count = 0;
    if (text.length > MARKDOWN_TAIL_TARGET + MARKDOWN_SEGMENT_CHARS) {
      for (const segment of all) {
        const nextEnd = end + segment.length;
        if (text.length - nextEnd < MARKDOWN_TAIL_TARGET) break;
        end = nextEnd;
        count++;
      }
    } else {
      count = all.length;
      end = text.length;
    }

    const committed = count > 0 ? all.slice(0, count) : [];
    const tailText = text.slice(end);

    // A fence opened in the settled region means the tail starts inside a code
    // block → render it as plain text (markdown would mis-format it).
    // (Segments are fence-contained, so scanning the committed region once is
    // equivalent to XOR-ing every segment's parity.)
    const settledFenceOpen = countFenceLines(text.slice(0, end)) % 2 === 1;

    return {
      segments: committed,
      tail: tailText,
      tailIsPlainText: settledFenceOpen,
    };
  }, [text, isStreaming]);

  return (
    <StreamingContext.Provider value={isStreaming}>
      <div className="relative">
        {segments.map((segment, index) => (
          <MarkdownSegment key={index} text={segment} components={markdownComponents} />
        ))}
        {tail && !tailIsPlainText && (
          <MarkdownSegment text={tail} components={markdownComponents} />
        )}
        {tail && tailIsPlainText && (
          <StreamingTail text={tail} isStreaming={isStreaming} />
        )}
      </div>
    </StreamingContext.Provider>
  );
},
// Compare by value, not reference: the parent passes linkifyCitations(part.text)
// which returns a fresh string each render even when the content is identical.
// A reference comparator would defeat the throttling of the streaming message
// and re-parse markdown on every chunk, recreating the #185 render storm.
(prev: { text: string; isStreaming: boolean }, next: { text: string; isStreaming: boolean }) =>
  prev.text === next.text && prev.isStreaming === next.isStreaming
);

// StreamingTail animates only the last N new characters as they arrive.
// Renders the settled prefix as plain text for performance.
function StreamingTail({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const prevLengthRef = useRef(0);
  const ANIMATED_CHARS = 200; // animate up to 200 new chars (covers multiple batches)

  // Track only the new characters since last render
  const newChars = useMemo(() => {
    if (!isStreaming) return [];
    const prevLen = prevLengthRef.current;
    const newLen = text.length;
    if (newLen <= prevLen) return [];
    const start = Math.max(prevLen, newLen - ANIMATED_CHARS);
    return text.slice(start, newLen).split("").map((ch, i) => ({ ch, index: start + i }));
  }, [text, isStreaming]);

  // Prefix text (already settled, no animation)
  const prefixText = useMemo(() => {
    if (!isStreaming) return text;
    const prevLen = prevLengthRef.current;
    const newLen = text.length;
    if (newLen <= prevLen) return text;
    const animStart = Math.max(prevLen, newLen - ANIMATED_CHARS);
    return text.slice(0, animStart);
  }, [text, isStreaming]);

  // Update ref after render
  useEffect(() => {
    prevLengthRef.current = text.length;
  }, [text]);

  return (
    <span className="streaming-tail whitespace-pre-wrap break-words">
      {prefixText && <span>{prefixText}</span>}
      {newChars.map(({ ch, index }) => (
        <span
          key={index}
          className="streaming-char streaming-char-new"
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
      {isStreaming && <span className="streaming-cursor" aria-hidden="true" />}
    </span>
  );
}

function ThoughtBlock({ data }: { data: any }) {
  const status = data?.status;
  const seconds = data?.seconds;
  const isThinking = status === "thinking";
  const [open, setOpen] = useState(isThinking);
  const thoughtText = data?.text ?? "";

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
              ? "text-white animate-pulse scale-110"
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
        <div className="mt-2 sm:mt-2.5 border-l-2 border-white/30 pl-2.5 sm:pl-3 text-[11px] sm:text-xs text-[#999] leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200 min-w-0 overflow-hidden">
          {thoughtText ? (
            <div className="relative prose prose-invert prose-xs max-w-none text-[#999]">
              <StreamingMarkdown
                text={thoughtText}
                isStreaming={isThinking}
              />
            </div>
          ) : isThinking ? (
            <div className="flex items-center gap-2 text-[#777] italic py-1">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" />
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
              ? "text-white animate-pulse"
              : isSearching
                ? "text-white animate-spin"
                : "text-[#888]"
          )}
        />
        <span className="font-medium text-[#aaa] group-hover:text-[#ddd]">
          {isGenerating || isSearching
            ? "Searching the web..."
            : status === "error"
              ? "Web search unavailable"
              : "Searched the web"}
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
                  className="text-white hover:underline"
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
function isWebSearchToolPart(part: any): boolean {
  if (!part || typeof part.type !== "string") return false;
  return (
    part.type === "tool-webSearch" ||
    (part.type === "dynamic-tool" && part.toolName === "webSearch")
  );
}

// Renders the live state of the native `webSearch` tool call: the model
// streaming the query, the search running, and the final results. Mirrors the
// look of SearchBlock so "tool calling" and "web searching" are visible
// without duplicating the results list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ToolSearchBlock({ part }: { part: any }) {
  const state = part?.state;
  const input = part?.input ?? {};
  const query = typeof input?.query === "string" ? input.query : "";
  const output = part?.output;
  const results = Array.isArray(output?.results) ? output.results : [];
  const isSearching =
    state === "input-streaming" || state === "input-available";
  const isError = state === "output-error";
  const [open, setOpen] = useState(isSearching);

  useEffect(() => {
    if (isSearching) setOpen(true);
  }, [isSearching]);

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
            isSearching
              ? query
                ? "text-white animate-spin"
                : "text-white animate-pulse"
              : "text-[#888]"
          )}
        />
        <span className="font-medium text-[#aaa] group-hover:text-[#ddd]">
          {isSearching
            ? "Searching the web..."
            : isError
              ? "Web search unavailable"
              : "Searched the web"}
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
                  className="text-white hover:underline"
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
  const { files, total, hasError, isDone, isReady } = useMemo(() => {
    let total = 0;
    let isDone = false;
    let isReady = false;
    const fileMap = new Map<number, { name: string; status: string }>();

    for (const part of parts) {
      const d = part.data;
      if (!d) continue;
      if (typeof d.total === "number") total = d.total;
      if (d.status === "done") isDone = true;
      if (d.status === "ready") isReady = true;
      if (d.filename && typeof d.index === "number") {
        fileMap.set(d.index, { name: d.filename, status: d.status });
      }
    }

    const files = Array.from({ length: total }, (_, i) => {
      const state = fileMap.get(i);
      return { name: state?.name ?? `File ${i + 1}`, status: state?.status ?? "pending" };
    });

    const hasError = parts.some((p) => p.data?.status === "error");

    return { files, total, hasError, isDone, isReady };
  }, [parts]);

  // For a single file, the server skips the analysis sub-call and sends
  // a "ready" event immediately. Don't show the analysis UI in that case.
  if (total === 1 && isReady) return null;
  if (total === 0) return null;

  // The scan is "active" while streaming AND the final "done" event hasn't
  // arrived yet. Once done (or the stream finished), animations freeze.
  const isScanning = isStreaming && !isDone && !hasError && !isReady;
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
                : "text-white animate-pulse"
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
            <span className="w-1 h-1 rounded-full bg-white animate-pulse [animation-delay:0ms]" />
            <span className="w-1 h-1 rounded-full bg-white animate-pulse [animation-delay:200ms]" />
            <span className="w-1 h-1 rounded-full bg-white animate-pulse [animation-delay:400ms]" />
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
                    ? "bg-white/15 border-white/50 text-white file-scan-chip-active"
                    : isReading
                      ? "bg-white/15 border-white/50 text-white"
                      : isDoneFile
                        ? "bg-[#22c55e]/10 border-[#22c55e]/40 text-[#22c55e]"
                        : isFailed
                          ? "bg-red-500/10 border-red-500/40 text-red-400"
                          : "bg-white/5 border-white/10 text-[#555]"
                )}
              >
                {isReading && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
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
                      ? "bg-white/30"
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
              className="h-full rounded-full bg-gradient-to-r from-white to-white/50 transition-all duration-500 ease-out"
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

function ChatMessageInner({
  message,
  onRegenerate,
  onEdit,
  isStreaming,
  interrupted,
  disableActions,
  animateIn = true,
  branchInfo,
  onBranchNav,
}: Props) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(() => messageText(message));

  useEffect(() => {
    if (!isEditing) {
      const next = messageText(message);
      // Avoid a state update (and the resulting re-render) when the derived
      // text is identical. During streaming the parent re-renders on every
      // chunk; for non-streaming messages this guard prevents redundant
      // setEditValue calls that contribute to render-storm pressure (#185).
      setEditValue((prev) => (prev === next ? prev : next));
    }
  }, [message, isEditing]);

  // Throttle the rendered message while streaming so a large reply (many code
  // blocks) does not re-render its whole markdown tree on every ~30ms chunk.
  // This is the main guard against React #185 mid-generation. When streaming
  // stops, `renderedMessage` snaps to the exact `message` so edits/copies see
  // the final content.
  const renderedMessage = useThrottledValue(message, Boolean(isStreaming), 200);

  const fileParts = renderedMessage.parts.filter((p) => p.type === "file");
  const scanParts = renderedMessage.parts.filter((p) => p.type === "data-file");
  const thoughtParts = renderedMessage.parts.filter((p) => p.type === "data-thought").slice(-1);
  const searchParts = renderedMessage.parts.filter((p) => p.type === "data-search").slice(-1);
  const toolParts = renderedMessage.parts.filter(isWebSearchToolPart);

  // Which "search" representation is live for this message — the native
  // tool part when webSearch ran as a tool call, otherwise the legacy
  // data-search progress part. Used to build the citation map below.
  const activeToolPart = toolParts[toolParts.length - 1] as any;
  const activeSearchPart = searchParts[searchParts.length - 1] as any;

  const citationResults = useMemo(() => {
    const results = activeToolPart?.output?.results ?? activeSearchPart?.data?.results ?? [];
    const map: Record<number, CitationEntry> = {};
    if (Array.isArray(results)) {
      results.forEach((r: any, i: number) => {
        map[i + 1] = { url: r?.url, title: r?.title };
      });
    }
    return map;
  }, [activeToolPart, activeSearchPart]);

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

  const showActions = isUser || !isStreaming;

  return (
    <div
      data-chat-message
      className={cn(
        "flex gap-2.5 sm:gap-4 w-full max-w-3xl mx-auto py-2.5 sm:py-4 transition-all duration-300",
        animateIn && "animate-in fade-in slide-in-from-bottom-2",
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
      <div className={cn("flex flex-col gap-1.5 sm:gap-2 min-w-0", isUser ? "items-end max-w-[70%] ml-auto" : "flex-1")}>
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
        {!isUser && (
          <div className="flex flex-col gap-2.5 sm:gap-3">
            {toolParts.length > 0
              ? toolParts
                  // Render each web-search tool call as its own block, but skip
                  // calls that are neither actively searching nor produced any
                  // results — those are the empty "no context" duplicates.
                  .filter(
                    (p: any) =>
                      p?.state === "input-streaming" ||
                      p?.state === "input-available" ||
                      (Array.isArray(p?.output?.results) && p.output.results.length > 0)
                  )
                  .map((p: any, i: number) => (
                    <ToolSearchBlock key={`tool-${i}`} part={p as any} />
                  ))
              : searchParts.map((p, i) => (
                  <SearchBlock key={`s-${i}`} data={(p as any).data} />
                ))}
          </div>
        )}
        {!isUser && thoughtParts.map((p, i) => (
          <ThoughtBlock key={`t-${i}`} data={(p as any).data} />
        ))}

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
              "text-xs sm:text-sm leading-relaxed min-w-0",
              isUser
                ? "w-fit max-w-full bg-[#1e1e1e] border border-[#2a2a2a] rounded-xl sm:rounded-2xl rounded-tr-sm px-3.5 py-2.5 sm:px-4 sm:py-3 text-white shadow-sm overflow-hidden break-words"
                : "w-full text-[#ddd] prose prose-invert prose-xs sm:prose-sm max-w-none overflow-visible"
            )}
          >
            {renderedMessage.parts.map((part, index) => {
              if (part.type === "text") {
                if (isUser) {
                  return (
                    <span key={index} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  );
                }
                return (
                  <CitationsContext.Provider key={index} value={citationResults}>
                    <StreamingMarkdown
                      text={linkifyCitations(part.text)}
                      isStreaming={Boolean(isStreaming)}
                    />
                  </CitationsContext.Provider>
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

            {!isUser && interrupted === "text" && (
              <span className="ml-1 text-[11px] sm:text-xs text-rose-400 font-medium select-none animate-in fade-in duration-200">
                You stopped the response
              </span>
            )}

            {branchInfo && branchInfo.total > 1 && (
              <div className="flex items-center gap-0.5 select-none">
                <button
                  onClick={() => onBranchNav?.("prev")}
                  disabled={disableActions || branchInfo.current <= 1}
                  className="p-1 sm:p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Previous version"
                >
                  <ChevronLeft className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                </button>
                <span className="text-[10px] sm:text-[11px] text-[#666] font-medium tabular-nums whitespace-nowrap">
                  {branchInfo.current} / {branchInfo.total}
                </span>
                <button
                  onClick={() => onBranchNav?.("next")}
                  disabled={disableActions || branchInfo.current >= branchInfo.total}
                  className="p-1 sm:p-1.5 rounded-md hover:bg-[#1e1e1e] hover:text-[#ccc] transition-all duration-150 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Next version"
                >
                  <ChevronRight className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Memoize so that during streaming — when `useChat` pushes a fresh `messages`
// array on every chunk — only the actively streaming message (whose `message`
// reference actually changes) re-renders. Non-streaming messages keep their
// object identity across chunks, so they are skipped entirely. Without this,
// every chunk re-rendered ALL messages, and with a long conversation history
// that render storm tripped React's "Maximum update depth exceeded" guard
// (#185) mid-generation.
//
// The comparator intentionally ignores the function props (onRegenerate /
// onEdit / onBranchNav): they are recreated inline on every parent render, so
// comparing them would defeat memoization. We compare only the data that
// affects what is drawn: the message object, streaming flag, and a few
// booleans. branchInfo is compared by its primitive fields rather than by
// reference because getBranchInfo() returns a fresh object each render.
const ChatMessage = memo(ChatMessageInner, (prev, next) => {
  const biPrev = prev.branchInfo;
  const biNext = next.branchInfo;
  const branchInfoEqual =
    (biPrev === undefined || biPrev === null) &&
    (biNext === undefined || biNext === null)
      ? true
      : biPrev?.current === biNext?.current && biPrev?.total === biNext?.total;

  return (
    prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.interrupted === next.interrupted &&
    prev.disableActions === next.disableActions &&
    prev.animateIn === next.animateIn &&
    branchInfoEqual
  );
});

export { ChatMessage };

export function TypingIndicator() {
  return (
    <div className="flex w-full max-w-3xl mx-auto mt-1 sm:mt-2 py-1 animate-in fade-in duration-300">
      <div className="flex items-center gap-1 py-1">
        <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:0ms]" />
        <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:150ms]" />
        <span className="w-1 h-1 bg-white rounded-full animate-bounce [animation-delay:300ms]" />
      </div>
    </div>
  );
}
