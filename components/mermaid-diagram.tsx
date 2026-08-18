"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  code: string;
};

// Characters that are illegal inside an *unquoted* Mermaid node label. When a
// model emits label text containing any of these without wrapping it in
// quotes, Mermaid throws "Syntax error in text" and refuses to render.
const UNSAFE_NODE_CHARS = /[()[\]{}:;#=<>|@]/;

const FLOWCHART_HEADER = /^(flowchart|graph)\b/i;
const VALID_DIRECTIONS = ["tb", "td", "bt", "rl", "lr"];

const stripFences = (raw: string): string => {
  const code = raw.trim();
  const fence = code.match(/^```(?:mermaid)?\s*\n([\s\S]*?)(?:\n```)?$/i);
  return fence ? fence[1].trim() : code;
};

const isFlowchart = (raw: string): boolean =>
  FLOWCHART_HEADER.test(stripFences(raw).split("\n", 1)[0].trim().toLowerCase());

const quoteLabel = (s: string): string => {
  const t = s.trim();
  if (!t) return t;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t;
  }
  return `"${t.replace(/"/g, "&quot;")}"`;
};

/**
 * Stage 1 repair — conservative label quoting.
 *
 * Only targets `flowchart`/`graph` diagrams, where the `[]`, `()` and `{}`
 * delimiters wrap free-form label text. Other diagram families (class, state,
 * ER, …) use those same delimiters structurally, so quoting them would break
 * otherwise-valid syntax — for those we return the input untouched.
 *
 * The transform only wraps a label when it is unquoted *and* actually contains
 * a character that requires quoting, so diagrams that are already valid pass
 * through untouched.
 */
function sanitizeMermaidCode(raw: string): string {
  const code = stripFences(raw);
  const firstLine = code.split("\n", 1)[0].trim().toLowerCase();
  if (!FLOWCHART_HEADER.test(firstLine)) return raw;

  const quoteInner = (inner: string): string => {
    const t = inner.trim();
    if (!t) return inner;
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
      return inner;
    }
    // Nested shapes like [[...]] / [(...)] — text is one level deeper.
    if (t.startsWith("[") || t.startsWith("(") || t.startsWith("{")) return inner;
    if (UNSAFE_NODE_CHARS.test(t)) {
      if (t.includes('"') && !t.includes("'")) return `'${t}'`;
      if (t.includes("'") && !t.includes('"')) return `"${t}"`;
      return `"${t.replace(/"/g, "&quot;")}"`;
    }
    return inner;
  };

  const out = code
    .split("\n")
    .map((line) => {
      let l = line.replace(
        /(\b[A-Za-z_][\w-]*\s*)(\[)([^\]\n]*?)(\])/g,
        (_m, id, open, inner, close) => id + open + quoteInner(inner) + close
      );
      l = l.replace(
        /(\b[A-Za-z_][\w-]*\s*)(\{)([^\}\n]*?)(\})/g,
        (_m, id, open, inner, close) => id + open + quoteInner(inner) + close
      );
      l = l.replace(
        /(\b[A-Za-z_][\w-]*\s*)(\()([^)\n]*?)(\))/g,
        (_m, id, open, inner, close) => id + open + quoteInner(inner) + close
      );
      return l;
    })
    .join("\n");

  // Normalise the header direction (e.g. "flowchart T" → "flowchart TD") so a
  // missing/invalid direction doesn't abort the whole parse.
  const headerFix = out.replace(
    /^(flowchart|graph)\b(\s+(\w+))?/i,
    (_m, kw, _sp, dir) =>
      `${kw} ${dir && VALID_DIRECTIONS.includes(dir.toLowerCase()) ? dir.toUpperCase() : "TD"}`
  );

  return headerFix;
}

/**
 * Stage 2 repair — structural reconstruction for severely corrupted
 * flowcharts. When a model emits garbage (unbalanced brackets, `>` instead of
 * `-->`, junk lines like `&` or bare numbers), we cannot recover the intended
 * topology. Instead we extract every salvageable label and rebuild a valid
 * linear flowchart so *something* renders rather than an error.
 *
 * Non-flowchart diagrams are returned unchanged — this is purely a last-resort
 * flowchart salvage.
 */
function repairFlowchart(raw: string): string {
  const code = stripFences(raw);
  if (!isFlowchart(code)) return raw;

  const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
  const hm = lines[0].match(/^(flowchart|graph)\b(\s+(\w+))?/i);
  const dir = hm && hm[3] && VALID_DIRECTIONS.includes(hm[3].toLowerCase())
    ? hm[3].toUpperCase()
    : "TD";
  const out: string[] = [`${hm ? hm[1] : "flowchart"} ${dir}`];

  const JUNK = /^[\d\s&|+*\-=/]+$/;
  let counter = 0;
  let prev: string | null = null;

  const pushNode = (label: string) => {
    const clean = label.replace(/[[\](){}]/g, "").trim();
    if (!clean || JUNK.test(clean)) return;
    const id = `N${counter++}`;
    out.push(`${id}[${quoteLabel(clean)}]`);
    if (prev) out.push(`${prev} --> ${id}`);
    prev = id;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (JUNK.test(line.replace(/[>\-]/g, ""))) continue;

    // Try to pull a label out of any bracket/paren group first.
    const bm = line.match(/[\[({]([^\[\]{}()]*)[)\]}]/);
    if (bm) {
      pushNode(bm[1]);
      continue;
    }

    // Otherwise strip arrows / stray brackets and treat the remainder as a label.
    const cleaned = line
      .replace(/^[>\-]+/, "")
      .replace(/^[\w-]*\]/, "")
      .replace(/[[\](){}]/g, "")
      .trim();
    pushNode(cleaned);
  }

  return out.join("\n");
}

/**
 * Stage 3 fallback — type-agnostic salvage.
 *
 * When the original diagram is so corrupted that even stage 2 cannot recover
 * it (e.g. a malformed sequence/class/state diagram), we extract every
 * salvageable label from the raw text and rebuild a fresh, guaranteed-valid
 * `flowchart TD`. This runs only as a last resort, so valid non-flowchart
 * diagrams are never touched on the normal path.
 */
function buildFallbackFlowchart(raw: string): string {
  const code = stripFences(raw);
  const lines = code.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return raw;

  const out: string[] = ["flowchart TD"];
  const JUNK = /^[\d\s&|+*\-=/]+$/;
  let counter = 0;
  let prev: string | null = null;

  const pushNode = (label: string) => {
    const clean = label.replace(/[[\](){}]/g, "").trim();
    if (!clean || JUNK.test(clean)) return;
    const id = `N${counter++}`;
    out.push(`${id}[${quoteLabel(clean)}]`);
    if (prev) out.push(`${prev} --> ${id}`);
    prev = id;
  };

  for (const line of lines) {
    if (JUNK.test(line.replace(/[>\-]/g, ""))) continue;

    // Pull labels from shape delimiters first (handles corrupted flowcharts,
    // sequence `A->>B: label`, class `class A { ... }`, etc.).
    const bm = line.match(/[\[({]([^\[\]{}()]*)[)\]}]/);
    if (bm) {
      pushNode(bm[1]);
      continue;
    }

    const cleaned = line
      .replace(/^[>\-]+/, "")
      .replace(/^[\w-]*\]/, "")
      .replace(/[[\](){}]/g, "")
      .trim();
    pushNode(cleaned);
  }

  return out.join("\n");
}

/**
 * Renders a Mermaid diagram (flowcharts, sequence diagrams, class diagrams,
 * state diagrams, Gantt charts, pie charts, git graphs, mindmaps, etc.).
 *
 * Mermaid is loaded lazily inside `useEffect` so it never blocks the initial
 * render, and each instance gets its own `render()` call so multiple diagrams
 * on the same page never collide (Mermaid's module-level `id` counter can
 * otherwise produce duplicate IDs).
 */
export function MermaidDiagram({ code }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  // Keep a stable copy of the code so a re-render with the same text doesn't
  // re-trigger the async render.
  const codeKey = code.trim();

  // Guard: nothing to render (e.g. empty/malformed code) — show the raw block
  // directly so we never spam the noisy mermaid error banner.
  useEffect(() => {
    setSvg(null);
    setError(null);
    setShowRaw(false);
    if (!codeKey) {
      setShowRaw(true);
    }
  }, [codeKey]);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        // Initialize once — subsequent calls reuse the configured instance.
        // We mutate a module-scoped object deliberately; the `startOnLoad`
        // flag prevents Mermaid from auto-scanning the DOM (which would
        // fight with our manual render calls).
        if (!(mermaid as any).__initialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            themeVariables: {
              darkMode: true,
              background: "#0d0d0d",
              primaryColor: "#1a1a1e",
              primaryTextColor: "#e8e8e8",
              primaryBorderColor: "#4a6cf7",
              lineColor: "#8c8f9c",
              secondaryColor: "#141418",
              tertiaryColor: "#111115",
              fontFamily: "Inter, sans-serif",
              fontSize: "11px",
              // Modern rounded corners on every node
              roundRadius: 8,
              // Slightly thicker, colored edges
              edgeLabelBackground: "#0d0d0d",
              lineColor: "#6b7280",
            },
            securityLevel: "loose",
            flowchart: {
              useMaxWidth: true,
              htmlLabels: true,
              curve: "basis",
              nodeSpacing: 20,
              rankSpacing: 25,
              padding: 8,
            },
          });
          (mermaid as any).__initialized = true;
        }

        const renderOnce = async (src: string) => {
          const rid = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
          return mermaid.render(rid, src);
        };

        // Skip the parse entirely when there is no code to render.
        if (!codeKey) return;

        try {
          const { svg } = await renderOnce(code);
          if (!cancelled) {
            setSvg(svg);
            setError(null);
          }
        } catch (renderErr) {
          // Stage 1 — conservative label quoting + direction normalisation.
          const fixed = sanitizeMermaidCode(code);
          if (fixed !== code.trim() && fixed !== code) {
            try {
              const { svg: fixedSvg } = await renderOnce(fixed);
              if (!cancelled) {
                setSvg(fixedSvg);
                setError(null);
              }
              return;
            } catch {
              // fall through to stage 2
            }
          }

          // Stage 2 — reconstruct a valid flowchart from salvageable labels
          // when the original is structurally corrupted beyond quoting fixes.
          const repaired = repairFlowchart(code);
          if (repaired !== code.trim() && repaired !== code) {
            try {
              const { svg: repairedSvg } = await renderOnce(repaired);
              if (!cancelled) {
                setSvg(repairedSvg);
                setError(null);
              }
              return;
            } catch {
              // fall through to stage 3
            }
          }

          // Stage 3 — type-agnostic salvage: extract whatever labels survive
          // and rebuild a guaranteed-valid flowchart. This is the final
          // attempt before we give up.
          const fallback = buildFallbackFlowchart(code);
          if (fallback !== code.trim() && fallback !== code) {
            try {
              const { svg: fallbackSvg } = await renderOnce(fallback);
              if (!cancelled) {
                setSvg(fallbackSvg);
                setError(null);
              }
              return;
            } catch {
              // fall through to original error
            }
          }

          // Nothing worked — show a clean, non-threatening panel with the raw
          // source instead of the noisy mermaid parse error banner.
          if (!cancelled) {
            setError(null);
            setShowRaw(true);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to render diagram";
          setError(message);
          setSvg(null);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [codeKey]);

  return (
    <div
      className={cn(
        "w-full rounded-2xl border border-white/10 bg-[#0d0d11]/95 p-3 sm:p-4 backdrop-blur-2xl"
      )}
    >
      {svg ? (
        <div
          className="mermaid-output overflow-x-auto [&>svg]:min-w-[640px] [&>svg]:block [&>svg]:mx-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : showRaw ? (
        <div className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-[#8c8f9c] text-[11px] font-medium">
            Diagram source
          </span>
          <pre className="text-[10px] text-[#c1c5d0] font-mono whitespace-pre-wrap break-words max-w-full bg-white/[0.03] border border-white/10 rounded-lg p-2.5">
            {code}
          </pre>
        </div>
      ) : (
        <div className="flex items-center justify-center py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#4a6cf7] border-t-transparent" />
        </div>
      )}
    </div>
  );
}