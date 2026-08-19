"use client";

import { useState } from "react";
import { Settings, X, Zap, Shield, AlertTriangle, RotateCcw, Trash2, Check, FolderX, Code2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelSettings, ModelParams, DEFAULT_MODEL_SETTINGS } from "@/lib/storage";
import { useDraggableResizable } from "@/lib/draggable-resizable";
import { useIsMobile } from "@/lib/use-is-mobile";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  settings: ModelSettings;
  onUpdateSettings: (newSettings: ModelSettings) => void;
  onDeleteAllChats: () => void;
  onDeleteAllFiles?: () => void;
};

type ActiveModelTab = "instant" | "expert" | "coding";

export function SettingsDialog({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onDeleteAllChats,
  onDeleteAllFiles,
}: Props) {
  const [activeTab, setActiveTab] = useState<ActiveModelTab>("instant");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteFilesConfirm, setShowDeleteFilesConfirm] = useState(false);
  const [showResetNotice, setShowResetNotice] = useState(false);

  const { position, size, isDragging, isResizing, handleDragStart, handleResizeStart, elRef } =
    useDraggableResizable({
      initialSize: { width: 512, height: 680 },
      minWidth: 320,
      minHeight: 480,
      maxWidth: 900,
      maxHeight: 860,
    });

  // On mobile, drag/resize are disabled and the dialog becomes a fixed,
  // full-screen sheet so it can't be moved or expanded off-screen.
  const isMobile = useIsMobile();
  const dialogStyle = isMobile
    ? { position: "fixed" as const, inset: 0, width: "100%", height: "100%", maxHeight: "100%" }
    : {
        position: "absolute" as const,
        left: position.x,
        top: position.y,
        width: size.width || "auto",
        height: size.height || "auto",
        maxHeight: "90vh",
      };

  if (!isOpen) return null;

  // When the dialog is shrunk below 560px wide, drop the larger "sm:" sizes so
  // the internal items and buttons scale down with the dialog.
  const compact = size.width > 0 && size.width < 560;
  const sz = (small: string, large: string) => (compact ? small : `${small} ${large}`);

  const currentParams = settings[activeTab];

  const handleParamChange = (key: keyof ModelParams, value: number) => {
    onUpdateSettings({
      ...settings,
      [activeTab]: {
        ...settings[activeTab],
        [key]: value,
      },
    });
  };

  const handleResetDefaults = () => {
    onUpdateSettings(DEFAULT_MODEL_SETTINGS);
    setShowResetNotice(true);
    setTimeout(() => setShowResetNotice(false), 2500);
  };

  const handleConfirmDeleteAll = () => {
    onDeleteAllChats();
    setShowDeleteConfirm(false);
    onClose();
  };

  const handleConfirmDeleteAllFiles = () => {
    onDeleteAllFiles?.();
    setShowDeleteFilesConfirm(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        ref={elRef}
        className={cn(
          "relative flex flex-col overflow-hidden rounded-[28px] bg-[#0d0d11]/95 backdrop-blur-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] text-white border border-white/10",
          isDragging ? "select-none" : "animate-in zoom-in-95 duration-200"
        )}
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          onMouseDown={isMobile ? undefined : handleDragStart}
          onTouchStart={isMobile ? undefined : handleDragStart}
          className={cn(
            "flex items-center justify-between",
            sz("px-4 pt-4 pb-3", "sm:px-6 sm:pt-6 sm:pb-4"),
            "flex-shrink-0",
            isMobile ? "" : isDragging ? "cursor-grabbing" : "cursor-grab"
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className={sz("p-2 rounded-xl", "sm:p-2.5 sm:rounded-2xl") + " bg-white/5 border border-white/10 text-white"}>
              <Settings className={sz("w-4.5 h-4.5", "sm:w-5 sm:h-5")} />
            </div>
            <div>
              <h2 className={sz("text-sm", "sm:text-base") + " font-semibold text-white tracking-wide"}>Model Settings</h2>
              <p className={sz("text-[9px]", "sm:text-xs") + " text-[#8c8f9c]"}>Customize model parameters & manage workspace</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={sz("p-1.5", "sm:p-2") + " rounded-full bg-white/5 hover:bg-white/10 text-[#8c8f9c] hover:text-white transition-colors"}
            aria-label="Close settings"
          >
            <X className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4")} />
          </button>
        </div>

        {/* Modal Body */}
        <div className={sz("flex-1 overflow-y-auto px-4 py-2 space-y-4", "sm:px-6 sm:py-2 sm:space-y-6") + " scrollbar-thin scrollbar-thumb-white/10"}>
          {/* Model Selection Tabs */}
          <div>
            <label className={sz("block text-[10px] font-bold text-[#8c8f9c] uppercase tracking-wider mb-2", "sm:text-[11px] sm:mb-2.5")}>
              Select Model Configuration
            </label>
            <div className={sz("grid grid-cols-3 gap-1 p-1 rounded-xl", "sm:p-1.5 sm:rounded-2xl") + " bg-white/[0.04] border border-white/10"}>
              <button
                type="button"
                onClick={() => setActiveTab("instant")}
                className={cn(
                  sz("flex items-center justify-center gap-1.5 py-2 rounded-lg", "sm:gap-2 sm:py-2.5 sm:rounded-xl") + " text-[10px] sm:text-xs font-semibold transition-all duration-200",
                  activeTab === "instant"
                    ? "bg-white/15 text-white border border-white/20 shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                    : "text-[#8c8f9c] hover:text-white hover:bg-white/5"
                )}
              >
                <Zap className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4")} />
                <span>Instant</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("expert")}
                className={cn(
                  sz("flex items-center justify-center gap-1.5 py-2 rounded-lg", "sm:gap-2 sm:py-2.5 sm:rounded-xl") + " text-[10px] sm:text-xs font-semibold transition-all duration-200",
                  activeTab === "expert"
                    ? "bg-white/15 text-white border border-white/20 shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                    : "text-[#8c8f9c] hover:text-white hover:bg-white/5"
                )}
              >
                <Shield className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4")} />
                <span>Expert</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("coding")}
                className={cn(
                  sz("flex items-center justify-center gap-1.5 py-2 rounded-lg", "sm:gap-2 sm:py-2.5 sm:rounded-xl") + " text-[10px] sm:text-xs font-semibold transition-all duration-200",
                  activeTab === "coding"
                    ? "bg-white/15 text-white border border-white/20 shadow-[0_0_12px_rgba(255,255,255,0.15)]"
                    : "text-[#8c8f9c] hover:text-white hover:bg-white/5"
                )}
              >
                <Code2 className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4")} />
                <span>Coding</span>
              </button>
            </div>
          </div>

          {/* Model Parameter Sliders */}
          <div className={sz("space-y-4 rounded-xl bg-white/[0.03] border border-white/10 p-4", "sm:space-y-5 sm:rounded-2xl sm:p-5")}>
            {/* Temperature */}
            <div className={sz("space-y-2", "sm:space-y-2.5")}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={sz("text-[10px]", "sm:text-xs") + " font-semibold text-white"}>Temperature</span>
                  <p className={sz("text-[9px]", "sm:text-[11px]") + " text-[#8c8f9c]"}>Controls randomness and creative variability</p>
                </div>
                <span className={sz("text-[10px] font-mono font-semibold px-2.5 py-1 rounded-lg", "sm:text-xs sm:px-3") + " bg-white/10 text-white border border-white/10"}>
                  {currentParams.temperature.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.05}
                value={currentParams.temperature}
                onChange={(e) => handleParamChange("temperature", parseFloat(e.target.value))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            {/* TOP_K */}
            <div className={sz("space-y-2", "sm:space-y-2.5")}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={sz("text-[10px]", "sm:text-xs") + " font-semibold text-white font-mono"}>TOP_K</span>
                  <p className={sz("text-[9px]", "sm:text-[11px]") + " text-[#8c8f9c]"}>Limits sampling pool to top K candidates</p>
                </div>
                <span className={sz("text-[10px] font-mono font-semibold px-2.5 py-1 rounded-lg", "sm:text-xs sm:px-3") + " bg-white/10 text-white border border-white/10"}>
                  {currentParams.topK}
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={currentParams.topK}
                onChange={(e) => handleParamChange("topK", parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>

            {/* Max Tokens */}
            <div className={sz("space-y-2", "sm:space-y-2.5")}>
              <div className="flex items-center justify-between">
                <div>
                  <span className={sz("text-[10px]", "sm:text-xs") + " font-semibold text-white"}>Max Tokens</span>
                  <p className={sz("text-[9px]", "sm:text-[11px]") + " text-[#8c8f9c]"}>Maximum response output length</p>
                </div>
                <span className={sz("text-[10px] font-mono font-semibold px-2.5 py-1 rounded-lg", "sm:text-xs sm:px-3") + " bg-white/10 text-white border border-white/10"}>
                  {currentParams.maxTokens}
                </span>
              </div>
              <input
                type="range"
                min={256}
                max={131072}
                step={512}
                value={currentParams.maxTokens}
                onChange={(e) => handleParamChange("maxTokens", parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
              />
            </div>
          </div>

          {/* DANGER ZONE */}
          <div className={sz("pt-1", "sm:pt-2")}>
            <div className={sz("flex items-center gap-2 mb-2", "sm:mb-3")}>
              <span className={sz("px-2 py-0.5 rounded-md text-[9px]", "sm:px-2.5 sm:py-1 sm:text-[10px]") + " font-extrabold uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20"}>
                Danger Zone
              </span>
            </div>

            <div className={sz("space-y-2", "sm:space-y-2.5")}>
              {/* Reset model settings button */}
              <button
                type="button"
                onClick={handleResetDefaults}
                className={sz("w-full flex items-center justify-between px-3 py-2 rounded-xl", "sm:px-4 sm:py-3 sm:rounded-2xl") + " bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 text-rose-400 text-[10px] sm:text-xs font-medium transition-all group active:scale-[0.99]"}
              >
                <div className={sz("flex items-center gap-2", "sm:gap-3")}>
                  <RotateCcw className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4") + " text-rose-400 group-hover:rotate-[-45deg] transition-transform"} />
                  <span>Reset all model settings to default</span>
                </div>
                {showResetNotice && (
                  <span className={sz("flex items-center gap-1 text-[9px]", "sm:text-[11px]") + " text-emerald-400 font-semibold animate-in fade-in"}>
                    <Check className={sz("w-3 h-3.5", "sm:w-3.5 sm:h-3.5")} />
                    Reset!
                  </span>
                )}
              </button>

              {/* Delete all files button */}
              {!showDeleteFilesConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteFilesConfirm(true)}
                  className={sz("w-full flex items-center justify-between px-3 py-2 rounded-xl", "sm:px-4 sm:py-3 sm:rounded-2xl") + " bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 text-rose-400 text-[10px] sm:text-xs font-medium transition-all group active:scale-[0.99]"}
                >
                  <div className={sz("flex items-center gap-2", "sm:gap-3")}>
                    <FolderX className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4") + " text-rose-400 group-hover:scale-110 transition-transform"} />
                    <span>Delete all uploaded files</span>
                  </div>
                  <AlertTriangle className={sz("w-3 h-3", "sm:w-3.5 sm:h-3.5") + " text-rose-400/60 group-hover:text-rose-400"} />
                </button>
              ) : (
                <div className={sz("p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[10px] space-y-2", "sm:p-4 sm:rounded-2xl sm:text-xs sm:space-y-3") + " animate-in fade-in duration-150"}>
                  <p className="text-rose-200 font-medium">
                    Are you sure? This will permanently delete all uploaded files across every chat.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteFilesConfirm(false)}
                      className={sz("px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px]", "sm:px-3 sm:py-1.5 sm:text-xs") + " transition-colors"}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDeleteAllFiles}
                      className={sz("px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[10px] shadow-lg shadow-rose-950/50", "sm:px-3 sm:py-1.5 sm:text-xs") + " transition-all"}
                    >
                      Confirm Delete All Files
                    </button>
                  </div>
                </div>
              )}

              {/* Delete all chat history button */}
              {!showDeleteConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className={sz("w-full flex items-center justify-between px-3 py-2 rounded-xl", "sm:px-4 sm:py-3 sm:rounded-2xl") + " bg-rose-500/5 hover:bg-rose-500/10 border border-rose-500/15 text-rose-400 text-[10px] sm:text-xs font-medium transition-all group active:scale-[0.99]"}
                >
                  <div className={sz("flex items-center gap-2", "sm:gap-3")}>
                    <Trash2 className={sz("w-3.5 h-3.5", "sm:w-4 sm:h-4") + " text-rose-400 group-hover:scale-110 transition-transform"} />
                    <span>Delete all chat history</span>
                  </div>
                  <AlertTriangle className={sz("w-3 h-3", "sm:w-3.5 sm:h-3.5") + " text-rose-400/60 group-hover:text-rose-400"} />
                </button>
              ) : (
                <div className={sz("p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[10px] space-y-2", "sm:p-4 sm:rounded-2xl sm:text-xs sm:space-y-3") + " animate-in fade-in duration-150"}>
                  <p className="text-rose-200 font-medium">
                    Are you sure? This will permanently delete all saved conversations and their files.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className={sz("px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[10px]", "sm:px-3 sm:py-1.5 sm:text-xs") + " transition-colors"}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDeleteAll}
                      className={sz("px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-semibold text-[10px] shadow-lg shadow-rose-950/50", "sm:px-3 sm:py-1.5 sm:text-xs") + " transition-all"}
                    >
                      Confirm Delete All
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className={sz("flex items-center justify-end px-4 pt-2 pb-4", "sm:px-6 sm:pt-3 sm:pb-6") + " flex-shrink-0"}>
          <button
            type="button"
            onClick={onClose}
            className={sz("px-5 py-2 rounded-full bg-white text-black hover:bg-white/90 text-xs font-semibold", "sm:px-6 sm:py-2.5") + " transition-all shadow-[0_0_15px_rgba(255,255,255,0.3)] active:scale-95"}
          >
            Done
          </button>
        </div>
        {/* Resize handle (bottom-right corner) — hidden on mobile where the
            dialog is a fixed full-screen sheet and must not be resizable. */}
        {!isMobile && (
          <div
            onMouseDown={handleResizeStart}
            onTouchStart={handleResizeStart}
            className="absolute bottom-0 right-0 z-50 flex h-6 w-6 cursor-se-resize touch-none items-end justify-end"
            aria-label="Resize dialog"
          >
            <Maximize2 className="mr-1 mb-1 h-3.5 w-3.5 text-white/30" />
          </div>
        )}
      </div>
    </div>
  );
}