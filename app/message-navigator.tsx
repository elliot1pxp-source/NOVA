"use client";

import { useState } from "react";

export interface NavItem {
  id: string;
  text: string;
  badge?: string;
}

interface MessageNavigatorProps {
  items: NavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
}

export function MessageNavigator({
  items,
  activeId,
  onSelect,
}: MessageNavigatorProps) {
  const [isHovered, setIsHovered] = useState(false);

  if (!items || items.length === 0) return null;

  return (
    <div
      className="fixed right-2 sm:right-4 top-1/2 -translate-y-1/2 z-30 flex flex-col items-end"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Collapsed State: Vertical Dash Ticks */}
      {!isHovered && (
        <div className="flex flex-col items-end gap-2.5 sm:gap-3.5 py-2 sm:py-3 px-1 cursor-pointer">
          {items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className="group focus:outline-none"
                title={item.text}
              >
                <div
                  className={`h-[2px] sm:h-[2.5px] rounded-full transition-all duration-200 ${
                    isActive
                      ? "w-3 sm:w-3.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                      : "w-2 sm:w-2.5 bg-neutral-600/70 hover:bg-neutral-300 hover:w-3 sm:hover:w-3.5"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}

      {/* Expanded Hover Card State */}
      {isHovered && (
        <div className="w-[220px] sm:w-[280px] max-h-[70vh] sm:max-h-[75vh] overflow-y-auto no-scrollbar bg-[#1c1c1e]/95 border border-white/10 rounded-xl sm:rounded-2xl p-3 sm:p-4 shadow-2xl backdrop-blur-xl transition-all duration-200 flex flex-col gap-1.5 sm:gap-2">
          {items.map((item) => {
            const isActive = item.id === activeId;
            return (
              <button
                key={item.id}
                onClick={() => onSelect(item.id)}
                className="flex items-center justify-between w-full text-left group gap-2 py-1 px-1.5 sm:py-1.5 sm:px-2 rounded-lg transition-colors hover:bg-white/5 cursor-pointer focus:outline-none"
              >
                <div className="flex items-center gap-1.5 sm:gap-2 truncate pr-1.5">
                  {item.badge && (
                    <span className="text-[9px] sm:text-[10px] bg-neutral-800 text-neutral-400 px-1 sm:px-1.5 py-0.5 rounded font-mono shrink-0 border border-white/5">
                      {item.badge}
                    </span>
                  )}
                  <span
                    className={`text-[11px] sm:text-xs truncate transition-colors ${
                      isActive
                        ? "text-white font-medium"
                        : "text-neutral-400 group-hover:text-neutral-200"
                    }`}
                  >
                    {item.text}
                  </span>
                </div>

                {/* Horizontal Dash Pill */}
                <div
                  className={`h-[2px] sm:h-[2.5px] shrink-0 rounded-full transition-all duration-200 ${
                    isActive
                      ? "w-3 sm:w-3.5 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"
                      : "w-2 sm:w-2.5 bg-neutral-600 group-hover:bg-neutral-400"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}