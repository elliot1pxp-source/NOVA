"use client";

import { useRef } from "react";
import { ArrowUp, Paperclip, Globe, Brain, X, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_ATTACHMENT_ACCEPT, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";

type Model = "instant" | "expert";

export type PendingAttachment = {
  id: string;
  file: File;
  previewUrl: string;
};

type Props = {
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  model: Model;
  deepThink: boolean;
  onToggleDeepThink: () => void;
  webSearch: boolean;
  onToggleWebSearch: () => void;
  attachments: PendingAttachment[];
  attachmentError?: string;
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
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
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if ((input.trim() || attachments.length > 0) && !isLoading) {
        onSubmit();
      }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e.target.value);
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }
  };

  const modelLabel = {
    instant: "Instant",
    expert: "Expert",
  }[model];

  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !isLoading;

  return (
    <div className="w-full max-w-3xl mx-auto">
    <div
    className={cn(
      "relative bg-[#1a1a1a] border rounded-2xl overflow-hidden shadow-lg transition-all duration-300",
      model === "expert"
        ? "border-[#4a6cf7]/65 shadow-[0_0_0_1px_rgba(74,108,247,0.16),0_0_22px_rgba(74,108,247,0.18)] focus-within:border-[#6d8cff] focus-within:shadow-[0_0_0_1px_rgba(74,108,247,0.3),0_0_28px_rgba(74,108,247,0.26)]"
        : "border-[#2a2a2a] focus-within:border-[#3a3a3a]"
    )}
    >
    {/* Attachment previews */}
    {attachments.length > 0 && (
      <div className="flex flex-wrap gap-2 px-4 pt-4">
      {attachments.map((att) => {
        const isImage = att.file.type.startsWith("image/");
        return (
          <div
          key={att.id}
          className="relative group w-16 h-16 rounded-lg overflow-hidden border border-[#2a2a2a] bg-[#111] flex items-center justify-center"
          >
          {isImage ? (
            <img src={att.previewUrl} alt={att.file.name} className="w-full h-full object-cover" />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 px-1">
            <FileText className="w-5 h-5 text-[#888]" />
            <span className="text-[9px] text-[#888] truncate w-full text-center">
            {att.file.name}
            </span>
            </div>
          )}
          <button
          type="button"
          onClick={() => onRemoveAttachment(att.id)}
          disabled={isLoading}
          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity disabled:pointer-events-none"
          aria-label="Remove attachment"
          >
          <X className="w-3 h-3" />
          </button>
          </div>
        );
      })}
      </div>
    )}

    {attachmentError && (
      <p className="px-4 pt-3 text-xs text-[#e87070]">{attachmentError}</p>
    )}

    {/* Textarea */}
    <textarea
    ref={textareaRef}
    value={input}
    onChange={handleChange}
    onKeyDown={handleKeyDown}
    disabled={isLoading}
    placeholder={isLoading ? "Waiting for NOVA to finish responding…" : `Message NOVA ${modelLabel}...`}
    rows={1}
    className={cn(
      "w-full bg-transparent text-white placeholder-[#555] px-4 pt-4 pb-2 resize-none focus:outline-none text-sm leading-relaxed min-h-[52px] max-h-[200px]",
      isLoading && "opacity-50 cursor-not-allowed"
    )}
    style={{ scrollbarWidth: "none" }}
    />

    {/* Bottom toolbar */}
    <div className="flex items-center justify-between px-3 pb-3 pt-1">
    <div className="flex items-center gap-1">
    {/* DeepThink toggle */}
    <button
    type="button"
    onClick={onToggleDeepThink}
    aria-pressed={deepThink}
    disabled={isLoading}
    className={cn(
      "flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all text-xs disabled:opacity-40 disabled:pointer-events-none",
      deepThink
      ? "bg-[#4a6cf7]/20 border-[#4a6cf7]/60 text-[#7d99ff] hover:bg-[#4a6cf7]/30 hover:border-[#4a6cf7]"
      : "border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#4a6cf7]/50 hover:bg-[#4a6cf7]/10"
    )}
    >
    <Brain className="w-3.5 h-3.5" />
    <span>DeepThink</span>
    </button>

    {/* Search toggle */}
    <button
    type="button"
    onClick={onToggleWebSearch}
    aria-pressed={webSearch}
    disabled={isLoading}
    className={cn(
      "flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all text-xs disabled:opacity-40 disabled:pointer-events-none",
      webSearch
      ? "bg-[#4a6cf7]/20 border-[#4a6cf7]/60 text-[#7d99ff] hover:bg-[#4a6cf7]/30 hover:border-[#4a6cf7]"
      : "border-[#2a2a2a] text-[#888] hover:text-white hover:border-[#4a6cf7]/50 hover:bg-[#4a6cf7]/10"
    )}
    >
    <Globe className="w-3.5 h-3.5" />
    <span>Search</span>
    </button>

    {/* Attachment */}
    <input
    ref={fileInputRef}
    type="file"
    multiple
    accept={SUPPORTED_ATTACHMENT_ACCEPT}
    className="hidden"
    onChange={(e) => {
      onAddFiles(e.target.files);
      e.target.value = "";
    }}
    disabled={isLoading}
    />
    <button
    type="button"
    onClick={() => fileInputRef.current?.click()}
    disabled={isLoading}
    className="p-1.5 text-[#666] hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none"
    aria-label="Attach file"
    title={SUPPORTED_ATTACHMENT_DESCRIPTION}
    >
    <Paperclip className="w-4 h-4" />
    </button>
    </div>

    {/* Send button */}
    <button
    type="button"
    onClick={() => {
      if (canSubmit) onSubmit();
    }}
    disabled={!canSubmit}
    className={cn(
      "w-8 h-8 rounded-full flex items-center justify-center transition-all",
      canSubmit
      ? "bg-[#4a6cf7] hover:bg-[#3a5ce7] text-white"
      : "bg-[#2a2a2a] text-[#555] cursor-not-allowed"
    )}
    aria-label="Send message"
    >
    {isLoading ? (
      <span className="w-3 h-3 rounded-sm bg-white/80 animate-pulse" />
    ) : (
      <ArrowUp className="w-4 h-4" />
    )}
    </button>
    </div>
    </div>

    <p className="text-center text-[11px] text-[#444] mt-3">
    NOVA can make mistakes. Consider checking important information.
      JOIN OUR TELEGRAM CHANNEL: @NOVAPXP
    </p>
    </div>
  );
}
