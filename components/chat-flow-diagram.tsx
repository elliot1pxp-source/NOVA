"use client";

import { cn } from "@/lib/utils";

type NodeVariant = "primary" | "secondary" | "accent" | "muted";

const VARIANT_STYLES: Record<NodeVariant, string> = {
  primary: "bg-[#1a1a1e] border-[#4a6cf7]/50 text-white",
  secondary: "bg-[#1a1a1e] border-[#4a6cf7]/40 text-white",
  accent: "bg-[#1a1a1e] border-[#7a8cff]/50 text-white",
  muted: "bg-[#141418] border-white/10 text-[#8c8f9c]",
};

function Node({
  children,
  variant = "primary",
  className,
}: {
  children: React.ReactNode;
  variant?: NodeVariant;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-xs font-medium shadow-sm",
        VARIANT_STYLES[variant],
        className
      )}
    >
      {children}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center text-[#4a6cf7]">
      <div className="h-4 w-0.5 bg-[#4a6cf7]/60" />
      <div className="h-0 w-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent border-t-[#4a6cf7]" />
      {label && <span className="mt-0.5 text-[9px] text-[#8c8f9c]">{label}</span>}
    </div>
  );
}

function BranchArrow() {
  return (
    <div className="flex justify-center">
      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#4a6cf7]/15 text-[#4a6cf7]">
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>
    </div>
  );
}

export function ChatFlowDiagram() {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#0d0d11]/95 p-4 sm:p-6 backdrop-blur-2xl">
      <div className="mb-3 flex items-center gap-2">
        <div className="h-2 w-2 rounded-full bg-[#4a6cf7]" />
        <span className="text-xs font-semibold text-white">Request Flow</span>
      </div>

      <div className="flex flex-col items-center gap-2">
        <Node variant="primary">User types</Node>
        <Arrow label="ChatInput" />
        <Node variant="primary">ChatView.handleSubmit()</Node>
        <Arrow label="POST /api/chat" />
        <Node variant="primary">messages, model, deepThink, webSearch</Node>

        <div className="w-full max-w-md">
          <BranchArrow />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center gap-2">
              <Node variant="secondary">File scan subcall</Node>
              <Arrow label="extraction" />
              <Node variant="secondary">Normalized messages</Node>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Node variant="secondary">tool(webSearch)</Node>
              <Arrow label="/api/search" />
              <Node variant="secondary">Serper scrape → citations</Node>
            </div>
          </div>
        </div>

        <Arrow label="merge" />
        <Node variant="accent">streamTextWithFallback</Node>
        <Arrow label="DeepThink reasoning" />
        <Node variant="accent">writer.write(data-thought/search/file)</Node>
        <Arrow label="render" />
        <Node variant="primary">ChatMessage segments + blocks</Node>

        <div className="w-full max-w-md">
          <BranchArrow />
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center gap-2">
              <Node variant="muted">localStorage</Node>
            </div>
            <div className="flex flex-col items-center gap-2">
              <Node variant="muted">/api/history</Node>
            </div>
          </div>
          <div className="flex justify-center text-[9px] text-[#8c8f9c]">Debounced save</div>
        </div>
      </div>
    </div>
  );
}