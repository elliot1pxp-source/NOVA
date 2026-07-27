"use client";

import { useRef, useEffect, KeyboardEvent, ChangeEvent } from "react";
import { 
  ArrowUp, 
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

export type PendingAttachment =
  | { id: string; source: "file"; file: File; previewUrl: string }
  | { id: string; source: "existing"; existingFile: ChatFile; previewUrl: string };

type ChatInputProps = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  model: "instant" | "expert";
  deepThink: boolean;
  onToggleDeepThink: () => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  attachments: PendingAttachment[];
  attachmentError?: string;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  existingFiles?: ChatFile[];
  onAttachExistingFile?: (file: ChatFile) => void;
};

export function ChatInput({
  input,
  onInputChange,
  onSubmit,
  isLoading,
  model,
  deepThink,
  onToggleDeepThink,
  webSearch,
  onToggleWebSearch,
  attachments,
  attachmentError,
  onAddFiles,
  onRemoveAttachment,
  existingFiles = [],
  onAttachExistingFile,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !isLoading;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-2">
      {/* Attachment Error Banner */}
      {attachmentError && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-800/50 rounded-xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-1">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{attachmentError}</span>
        </div>
      )}

      {/* Main Dynamic Input Container */}
      <div className="relative group w-full">
        {/* Soft Ambient White Glow Layer */}
        <div className="absolute -inset-1 rounded-[28px] bg-gradient-to-r from-white/10 via-white/20 to-white/10 blur-xl opacity-30 group-hover:opacity-60 group-focus-within:opacity-100 transition duration-500 pointer-events-none" />

        {/* Floating Capsule Body */}
        <div className="relative flex flex-col bg-[#0a0a0c]/85 backdrop-blur-2xl border border-white/20 focus-within:border-white/40 rounded-[26px] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.85),0_0_20px_rgba(255,255,255,0.06)] transition-all duration-300">
          
          {/* Pending Attachments List */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2 pt-1 pb-3 border-b border-white/10 mb-2">
              {attachments.map((att) => {
                const name = att.source === "file" ? att.file.name : att.existingFile.name;
                const isImage = att.previewUrl && (att.source === "file" ? att.file.type.startsWith("image/") : att.existingFile.mimeType.startsWith("image/"));

                return (
                  <div
                    key={att.id}
                    className="group/chip relative flex items-center gap-2 bg-white/10 border border-white/15 rounded-xl p-1.5 pr-2 text-xs text-white shadow-sm transition hover:bg-white/15"
                  >
                    {isImage ? (
                      <img src={att.previewUrl} alt={name} className="w-7 h-7 object-cover rounded-lg" />
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center">
                        <FileText className="w-4 h-4 text-white/70" />
                      </div>
                    )}
                    <span className="max-w-[130px] truncate font-medium">{name}</span>
                    <button
                      onClick={() => onRemoveAttachment(att.id)}
                      className="ml-1 p-0.5 rounded-full hover:bg-white/20 text-white/60 hover:text-white transition"
                    >
                      <X className="w-3.5 h-3.5" />
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
            placeholder={`Message NOVA ${model === "instant" ? "Instant" : "Expert"}...`}
            rows={1}
            className="w-full bg-transparent text-white placeholder-[#787a85] text-sm px-3 py-1.5 focus:outline-none resize-none max-h-[200px] leading-relaxed scrollbar-none"
          />

          {/* Input Action Controls Bar */}
          <div className="flex items-center justify-between pt-2 px-1">
            {/* Left Controls: Feature Pills & File Upload */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* DeepThink Switcher Pill */}
              <button
                type="button"
                onClick={onToggleDeepThink}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 border select-none",
                  deepThink
                    ? "bg-white/20 border-white/40 text-white shadow-[0_0_12px_rgba(255,255,255,0.2)]"
                    : "bg-white/5 border-white/10 text-[#8c8f9c] hover:text-white hover:bg-white/10 hover:border-white/20"
                )}
              >
                <Brain className="w-3.5 h-3.5" />
                <span>DeepThink</span>
              </button>

              {/* Web Search Switcher Pill */}
              <button
                type="button"
                onClick={onToggleWebSearch}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 border select-none",
                  webSearch
                    ? "bg-white/20 border-white/40 text-white shadow-[0_0_12px_rgba(255,255,255,0.2)]"
                    : "bg-white/5 border-white/10 text-[#8c8f9c] hover:text-white hover:bg-white/10 hover:border-white/20"
                )}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Search</span>
              </button>

              {/* Attach File Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-1.5 rounded-full text-[#8c8f9c] hover:text-white hover:bg-white/10 transition duration-200"
                title="Attach files"
              >
                <Paperclip className="w-4 h-4" />
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

              {/* Reuse Storage Files Dropdown/Pill (if available) */}
              {existingFiles.length > 0 && onAttachExistingFile && (
                <div className="relative group/files">
                  <button
                    type="button"
                    className="p-1.5 rounded-full text-[#8c8f9c] hover:text-white hover:bg-white/10 transition duration-200"
                    title="Reuse existing chat files"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>

                  {/* Context menu for existing files */}
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover/files:flex flex-col bg-[#141418] border border-white/15 rounded-2xl p-2 shadow-2xl z-50 min-w-[200px] max-h-[180px] overflow-y-auto">
                    <span className="text-[10px] font-semibold text-white/50 uppercase px-2 py-1">Recent Chat Files</span>
                    {existingFiles.map((file) => (
                      <button
                        key={file.id}
                        onClick={() => onAttachExistingFile(file)}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-white/10 rounded-xl text-xs text-white/90 text-left truncate transition"
                      >
                        <FileText className="w-3.5 h-3.5 text-white/60 flex-shrink-0" />
                        <span className="truncate">{file.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Controls: Send Button */}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={cn(
                "p-2 rounded-full transition-all duration-300 flex items-center justify-center",
                canSubmit
                  ? "bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.4)] hover:scale-105 active:scale-95 cursor-pointer"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              )}
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>

      {/* Footer Disclaimer */}
      <p className="text-[11px] text-center text-[#6e717c] font-medium tracking-wide">
        NOVA can make mistakes. Consider checking important information.
      </p>
    </div>
  );
}