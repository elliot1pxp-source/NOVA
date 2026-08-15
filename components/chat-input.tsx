"use client";

import { useRef, useEffect, useState, KeyboardEvent, ChangeEvent } from "react";
import { 
  ArrowUp,
  Square,
  Paperclip, 
  X, 
  Brain, 
  Globe, 
  FileText, 
  AlertCircle,
  FolderOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ChatFile } from "@/lib/storage";
import { openPaidTierDialog } from "@/lib/paid-tier";

export type PendingAttachment =
  | { id: string; source: "file"; file: File; previewUrl: string }
  | { id: string; source: "existing"; existingFile: ChatFile; previewUrl: string };

type FreeTierStatus = {
  count: number;
  remaining: number;
  blocked: boolean;
  blockedUntil?: string;
};

export type ReasoningLevel = "low" | "medium" | "high" | "xhigh";
const REASONING_LEVELS: ReasoningLevel[] = ["low", "medium", "high", "xhigh"];
const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
};

type ChatInputProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void | Promise<void>;
  isLoading: boolean;
  model: "instant" | "expert" | "coding";
  deepThink: boolean;
  onToggleDeepThink: () => void;
  /** Selected native reasoning strength — only meaningful while DeepThink is on. */
  reasoningLevel: ReasoningLevel;
  onReasoningLevelChange: (level: ReasoningLevel) => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  /** Web search is unavailable while files are attached (files + search cannot run together). */
  webSearchDisabled?: boolean;
  attachments: PendingAttachment[];
  attachmentError?: string;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  existingFiles?: ChatFile[];
  onAttachExistingFile?: (file: ChatFile) => void;
  freeTierStatus?: FreeTierStatus | null;
  showFreeTierUsage?: boolean;
  /** Whether the user has an active paid tier (for gating high/xhigh reasoning). */
  isPaidUser?: boolean;
};

export function ChatInput({
  input,
  onInputChange,
  onSubmit,
  onStop,
  isLoading,
  model,
  deepThink,
  onToggleDeepThink,
  reasoningLevel,
  onReasoningLevelChange,
  webSearch,
  onToggleWebSearch,
  webSearchDisabled = false,
  attachments,
  attachmentError,
  onAddFiles,
  onRemoveAttachment,
  existingFiles = [],
  onAttachExistingFile,
  freeTierStatus = null,
  showFreeTierUsage = false,
  isPaidUser = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExistingFilesOpen, setIsExistingFilesOpen] = useState(false);

  // Auto-resize textarea height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isMobile = window.matchMedia("(pointer: coarse) and (max-width: 768px)").matches;
    if (isMobile) return;

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const isBlocked = showFreeTierUsage && freeTierStatus?.blocked && !isPaidUser;
  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !isLoading && !isBlocked;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-1.5 sm:gap-2">
      {/* Attachment Error Banner */}
      {attachmentError && (
        <div className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl">
          <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
          <span>{attachmentError}</span>
        </div>
      )}

      {/* Main Dynamic Input Container */}
      <div className="relative w-full">
        {/* Floating Capsule Body */}
        <div className="relative flex flex-col bg-[#0a0a0c]/95 border border-white/10 focus-within:border-white/30 rounded-[20px] sm:rounded-[26px] p-2 sm:p-3 transition-all duration-300">
          
          {/* Pending Attachments List */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 sm:gap-2 px-1.5 pt-0.5 pb-2 sm:px-2 sm:pt-1 sm:pb-3 border-b border-white/10 mb-1.5 sm:mb-2">
              {attachments.map((att) => {
                const name = att.source === "file" ? att.file.name : att.existingFile.name;
                const isImage = att.previewUrl && (att.source === "file" ? att.file.type.startsWith("image/") : att.existingFile.mimeType.startsWith("image/"));

                return (
                  <div
                    key={att.id}
                    className="group/chip relative flex items-center gap-1.5 sm:gap-2 bg-white/10 border border-white/15 rounded-lg sm:rounded-xl p-1 pr-1.5 sm:p-1.5 sm:pr-2 text-[11px] sm:text-xs text-white transition hover:bg-white/15"
                  >
                    {isImage ? (
                      <img src={att.previewUrl} alt={name} className="w-6 h-6 sm:w-7 sm:h-7 object-cover rounded-md sm:rounded-lg" />
                    ) : (
                      <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md sm:rounded-lg bg-white/10 flex items-center justify-center">
                        <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white/70" />
                      </div>
                    )}
                    <span className="max-w-[100px] sm:max-w-[130px] truncate font-medium">{name}</span>
                    <button
                      onClick={() => onRemoveAttachment(att.id)}
                      className="ml-0.5 p-0.5 rounded-full hover:bg-white/20 text-white/60 hover:text-white transition"
                    >
                      <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Text Area Input */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message NOVA ${model === "instant" ? "Instant" : model === "coding" ? "Coding" : "Expert"}...`}
            rows={1}
            className="w-full min-h-[40px] bg-transparent text-white placeholder-[#787a85] text-sm px-2 sm:px-3 py-2 sm:py-2.5 focus:outline-none resize-none max-h-[160px] sm:max-h-[200px] leading-relaxed"
          />

          {/* Input Action Controls Bar */}
          <div className="flex items-center justify-between pt-1.5 sm:pt-2 px-0.5 sm:px-1 gap-1">
            {/* Left Controls: Feature Pills & File Upload */}
            <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
              {/* DeepThink Switcher Pill */}
              <button
                type="button"
                onClick={onToggleDeepThink}
                className={cn(
                  "flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold transition-all duration-300 border select-none",
                  deepThink
                    ? "bg-white/20 border-white/40 text-white"
                    : "bg-white/5 border-white/10 text-[#8c8f9c] hover:text-white hover:bg-white/10 hover:border-white/20"
                )}
              >
                <Brain className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>DeepThink</span>
              </button>

              {/* Reasoning Level Selector — shown only while DeepThink is ON */}
              {deepThink && (
                <div
                  className="flex items-center gap-0.5 sm:gap-1 rounded-full bg-white/5 border border-white/10 p-0.5 animate-in fade-in slide-in-from-left-1 duration-200"
                  role="group"
                  aria-label="Reasoning level"
                >
                  {REASONING_LEVELS.map((level) => {
                    const isRestricted = (level === "high" || level === "xhigh") && !isPaidUser;
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => {
                          if (isRestricted) {
                            // Not available on the free tier — surface the paid tier dialog.
                            openPaidTierDialog();
                            return;
                          }
                          onReasoningLevelChange(level);
                        }}
                        aria-pressed={reasoningLevel === level}
                        aria-disabled={isRestricted}
                        title={isRestricted ? "Requires paid tier — click to unlock" : undefined}
                        className={cn(
                          "px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] sm:text-[11px] font-semibold capitalize transition-all duration-200 select-none",
                          isRestricted
                            ? "text-[#4a4d5a] cursor-not-allowed opacity-50 hover:text-amber-400/70 hover:opacity-80"
                            : reasoningLevel === level
                              ? "bg-white/20 text-white"
                              : "text-[#8c8f9c] hover:text-white hover:bg-white/10"
                        )}
                      >
                        {REASONING_LEVEL_LABELS[level]}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Web Search Switcher Pill */}
              <button
                type="button"
                onClick={webSearchDisabled ? undefined : onToggleWebSearch}
                disabled={webSearchDisabled}
                title={
                  webSearchDisabled
                    ? "Web search is unavailable while files are attached"
                    : "Toggle web search"
                }
                className={cn(
                  "flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full text-[10px] sm:text-xs font-semibold transition-all duration-300 border select-none",
                  webSearchDisabled
                    ? "bg-white/[0.03] border-white/5 text-[#4a4d5a] cursor-not-allowed"
                    : webSearch
                      ? "bg-white/20 border-white/40 text-white"
                      : "bg-white/5 border-white/10 text-[#8c8f9c] hover:text-white hover:bg-white/10 hover:border-white/20"
                )}
              >
                <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span>Search</span>
              </button>

              {/* Attach File Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1 sm:p-1.5 rounded-full text-[#8c8f9c] hover:text-white hover:bg-white/10 transition duration-200"
                title="Attach files"
              >
                <Paperclip className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  onAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />

              {/* Reuse Storage Files Dropdown/Pill */}
              {existingFiles.length > 0 && onAttachExistingFile && model === "instant" && (
                <div className="relative group/files">
                  <button
                    type="button"
                    onClick={() => setIsExistingFilesOpen((open) => !open)}
                    className="p-1 sm:p-1.5 rounded-full text-[#8c8f9c] hover:text-white hover:bg-white/10 transition duration-200"
                    title="Reuse existing chat files"
                    aria-label="Reuse existing chat files"
                    aria-expanded={isExistingFilesOpen}
                    aria-haspopup="menu"
                  >
                    <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  </button>

                  {/* Context menu for existing files */}
                  <div
                    className={cn(
                      "absolute left-0 bottom-full flex-col bg-[#141418] border border-white/15 rounded-2xl p-2 z-50 min-w-[180px] sm:min-w-[200px] max-h-[180px] overflow-y-auto",
                      isExistingFilesOpen ? "flex" : "hidden group-hover/files:flex"
                    )}
                    role="menu"
                  >
                    <span className="text-[9px] sm:text-[10px] font-semibold text-white/50 uppercase px-2 py-1">Recent Chat Files</span>
                    {existingFiles.map((file) => (
                      <button
                        key={file.id}
                        onClick={() => {
                          onAttachExistingFile(file);
                          setIsExistingFilesOpen(false);
                        }}
                        role="menuitem"
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/10 rounded-xl text-[11px] sm:text-xs text-white/90 text-left truncate transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Controls: Usage monitor + Send Button */}
            <div className="flex items-center gap-2">
              {showFreeTierUsage && freeTierStatus && !isPaidUser && (
                <span
                  className={cn(
                    "text-[10px] sm:text-[11px] font-semibold whitespace-nowrap",
                    freeTierStatus.blocked ? "text-rose-300" : "text-[#8c8f9c]"
                  )}
                >
                  {freeTierStatus.blocked
                    ? "20/20 — wait 3 hours"
                    : `${freeTierStatus.count}/20`}
                </span>
              )}
              {isLoading ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="p-1.5 sm:p-2 rounded-full bg-white/15 text-white border border-white/20 hover:bg-white/25 hover:scale-105 active:scale-95 transition-all duration-200 flex items-center justify-center cursor-pointer"
                  aria-label="Stop generating"
                  title="Stop generating"
                >
                  <Square className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!canSubmit}
                  className={cn(
                    "p-1.5 sm:p-2 rounded-full transition-all duration-300 flex items-center justify-center",
                    canSubmit
                      ? "bg-white text-black hover:scale-105 active:scale-95 cursor-pointer"
                      : "bg-white/10 text-white/30 cursor-not-allowed"
                  )}
                >
                  <ArrowUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer Disclaimer */}
      <p className="text-[9px] sm:text-[11px] text-center text-[#6e717c] font-medium tracking-wide">
        NOVA can make mistakes. Consider checking important information. By chatting with NOVA, you agree that everything you do is at your own risk. NOVA is not responsible for any consequences of your actions.
      </p>
    </div>
  );
}
