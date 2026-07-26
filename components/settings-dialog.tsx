"use client";

import { useState } from "react";
import { Settings, X, Zap, Shield, AlertTriangle, RotateCcw, Trash2, Check, FolderX } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelSettings, ModelParams, DEFAULT_MODEL_SETTINGS } from "@/lib/storage";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  settings: ModelSettings;
  onUpdateSettings: (newSettings: ModelSettings) => void;
  onDeleteAllChats: () => void;
  onDeleteAllFiles?: () => void;
};

type ActiveModelTab = "instant" | "expert";

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

  if (!isOpen) return null;

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden rounded-3xl bg-[#14151b]/85 border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.7)] backdrop-blur-2xl text-white animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Overhead Liquid Glass Gloss Highlight */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/5 border border-white/10 shadow-inner">
              <Settings className="w-5 h-5 text-[#4a6cf7]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">Model Settings</h2>
              <p className="text-xs text-[#888c99]">Customize model parameters & manage workspace</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-[#888c99] hover:text-white transition-colors"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10">
          {/* Model Selection Tabs */}
          <div>
            <label className="block text-xs font-semibold text-[#a0a5b5] uppercase tracking-wider mb-2.5">
              Select Model Configuration
            </label>
            <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-black/30 border border-white/5 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setActiveTab("instant")}
                className={cn(
                  "flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                  activeTab === "instant"
                    ? "bg-[#4a6cf7] text-white shadow-lg shadow-[#4a6cf7]/30 border border-white/10"
                    : "text-[#888c99] hover:text-white hover:bg-white/5"
                )}
              >
                <Zap className="w-4 h-4" />
                <span>Instant Model</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("expert")}
                className={cn(
                  "flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200",
                  activeTab === "expert"
                    ? "bg-[#4a6cf7] text-white shadow-lg shadow-[#4a6cf7]/30 border border-white/10"
                    : "text-[#888c99] hover:text-white hover:bg-white/5"
                )}
              >
                <Shield className="w-4 h-4" />
                <span>Expert Model</span>
              </button>
            </div>
          </div>

          {/* Model Parameter Sliders */}
          <div className="space-y-5 rounded-2xl bg-white/[0.03] border border-white/5 p-4 backdrop-blur-md">
            {/* Temperature */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-white">Temperature</span>
                  <p className="text-[11px] text-[#777b8e]">Controls randomness and creative variability</p>
                </div>
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-[#7d99ff]">
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
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#4a6cf7]"
              />
            </div>

            {/* TOP_K */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-white font-mono">TOP_K</span>
                  <p className="text-[11px] text-[#777b8e]">Limits sampling pool to top K candidates</p>
                </div>
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-[#7d99ff]">
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
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#4a6cf7]"
              />
            </div>

            {/* Max Tokens */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-white">Max Tokens</span>
                  <p className="text-[11px] text-[#777b8e]">Maximum response output length</p>
                </div>
                <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded-lg bg-black/40 border border-white/10 text-[#7d99ff]">
                  {currentParams.maxTokens}
                </span>
              </div>
              <input
                type="range"
                min={256}
                max={8192}
                step={256}
                value={currentParams.maxTokens}
                onChange={(e) => handleParamChange("maxTokens", parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#4a6cf7]"
              />
            </div>
          </div>

          {/* DANGER ZONE */}
          <div className="pt-2">
            <div className="flex items-center gap-2 mb-3">
              <span className="px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider bg-red-500/15 text-red-400 border border-red-500/30">
                Danger Zone
              </span>
              <div className="h-px flex-1 bg-red-500/20" />
            </div>

            <div className="space-y-2.5">
              {/* Reset model settings button */}
              <button
                type="button"
                onClick={handleResetDefaults}
                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300 hover:text-red-200 text-xs font-medium transition-all group active:scale-[0.99]"
              >
                <div className="flex items-center gap-2.5">
                  <RotateCcw className="w-4 h-4 text-red-400 group-hover:rotate-[-45deg] transition-transform" />
                  <span>Reset all the model settings to default</span>
                </div>
                {showResetNotice && (
                  <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-semibold animate-in fade-in">
                    <Check className="w-3.5 h-3.5" />
                    Reset!
                  </span>
                )}
              </button>

              {/* Delete all files button */}
              {!showDeleteFilesConfirm ? (
                <button
                  type="button"
                  onClick={() => setShowDeleteFilesConfirm(true)}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300 hover:text-red-200 text-xs font-medium transition-all group active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2.5">
                    <FolderX className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
                    <span>Delete all uploaded files</span>
                  </div>
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400/60 group-hover:text-red-400" />
                </button>
              ) : (
                <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs space-y-2.5 animate-in fade-in duration-150">
                  <p className="text-red-200 font-medium">
                    Are you sure? This will permanently delete all uploaded files across every chat.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteFilesConfirm(false)}
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDeleteAllFiles}
                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold shadow-lg shadow-red-900/50 transition-all"
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
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-300 hover:text-red-200 text-xs font-medium transition-all group active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2.5">
                    <Trash2 className="w-4 h-4 text-red-400 group-hover:scale-110 transition-transform" />
                    <span>Delete all the chat history</span>
                  </div>
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400/60 group-hover:text-red-400" />
                </button>
              ) : (
                <div className="p-3.5 rounded-xl bg-red-950/40 border border-red-500/40 text-xs space-y-2.5 animate-in fade-in duration-150">
                  <p className="text-red-200 font-medium">
                    Are you sure? This will permanently delete all saved conversations and their files.
                  </p>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmDeleteAll}
                      className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold shadow-lg shadow-red-900/50 transition-all"
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
        <div className="flex items-center justify-end px-6 py-4 border-t border-white/10 bg-black/20 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#4a6cf7] hover:bg-[#3a5ce7] text-white text-xs font-semibold transition-all shadow-lg shadow-[#4a6cf7]/30 active:scale-95"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}