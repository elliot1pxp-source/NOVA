"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  code: string;
};

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

  // Keep a stable copy of the code so a re-render with the same text doesn't
  // re-trigger the async render.
  const codeKey = code.trim();

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

        // Generate a unique ID per diagram so Mermaid's internal counter
        // never produces a duplicate that throws.
        const id = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(svg);
          setError(null);
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
      ) : error ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-[#ff6b6b] text-xs font-medium">
            Diagram failed to render
          </span>
          <pre className="text-[10px] text-[#8c8f9c] font-mono whitespace-pre-wrap break-words max-w-full">
            {error}
          </pre>
          <pre className="text-[10px] text-[#8c8f9c] font-mono whitespace-pre-wrap break-words max-w-full mt-1 opacity-60">
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