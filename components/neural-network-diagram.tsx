"use client";

import { cn } from "@/lib/utils";

type Column = {
  label: string;
  nodeCount: number;
};

function Node({ active }: { active?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-bold transition-all",
        active
          ? "border-white bg-white/25 text-black shadow-[0_0_10px_rgba(255,255,255,0.5)]"
          : "border-white/30 bg-white/5 text-white/60"
      )}
    >
      <span className="sr-only">node</span>
    </div>
  );
}

/**
 * Renders the ASCII neural-network diagram as real visual UI:
 *   [Input Layer]   [Hidden Layer]   [Output Layer]
 *    o   o   o        o   o   o         o   o
 *     \  |  /          \  |  /          \  |  /
 *      \ | /            \ | /            \| /
 *       \|/              \|/             \|
 *    [Weights]        [Weights]       [Weights]
 *
 * Each column is self-contained: nodes on top, weight lines converging
 * downward to a single point, then the [Weights] label.
 */
export function NeuralNetworkDiagram() {
  const columns: Column[] = [
    { label: "[Input Layer]", nodeCount: 3 },
    { label: "[Hidden Layer]", nodeCount: 3 },
    { label: "[Output Layer]", nodeCount: 2 },
  ];

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#0d0d11]/95 p-4 sm:p-6 backdrop-blur-2xl">

      <div className="flex flex-wrap items-start justify-center gap-6 sm:gap-8">
        {columns.map((col, colIdx) => (
          <div key={colIdx} className="flex flex-col items-center">
            <span className="mb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8c8f9c]">
              {col.label}
            </span>

            {/* Nodes row */}
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              {Array.from({ length: col.nodeCount }).map((_, i) => (
                <Node key={i} active={i === 1} />
              ))}
            </div>

            {/* Weight lines converging downward */}
            <WeightLines nodeCount={col.nodeCount} />

            <span className="mt-1 text-[10px] font-mono font-bold uppercase tracking-wider text-[#8c8f9c]">
              [Weights]
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * SVG weight lines: each node connects down to a single convergence point
 * at the bottom (the [Weights] label), matching the ASCII fan-out.
 */
function WeightLines({ nodeCount }: { nodeCount: number }) {
  const width = 120;
  const height = 56;
  const nodeY = 6;
  const convergeY = height - 4;
  const convergeX = width / 2;
  const startX = 14;
  const endX = width - 14;
  const step = (endX - startX) / Math.max(1, nodeCount - 1);

  const lines: React.JSX.Element[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const x = nodeCount === 1 ? convergeX : startX + i * step;
    const opacity = 0.3 + (0.5 * i) / Math.max(1, nodeCount - 1);
    lines.push(
      <line
        key={i}
        x1={x}
        y1={nodeY}
        x2={convergeX}
        y2={convergeY}
        stroke="rgba(255,255,255,0.6)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        strokeOpacity={opacity}
      />
    );
  }

  return (
    <svg
      className="h-14 w-[120px]"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {lines}
    </svg>
  );
}