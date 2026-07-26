"use client";

import { useRef, useState, useEffect } from "react";
import { ArrowUp, Paperclip, Globe, Brain, X, FileText, Upload, HardDrive } from "lucide-react";
import { cn } from "@/lib/utils";
import { SUPPORTED_ATTACHMENT_ACCEPT, SUPPORTED_ATTACHMENT_DESCRIPTION } from "@/lib/attachments";
import { ChatFile } from "@/lib/storage";

type Model = "instant" | "expert";

export type PendingAttachment = {
  id: string;
  previewUrl: string;
} & (
  | { source: "file"; file: File }
  | { source: "existing"; existingFile: ChatFile }
);

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
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileDropdownOpen, setFileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!fileDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setFileDropdownOpen(false);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [fileDropdownOpen]);

  const modelLabel = {
    instant: "Instant",
    expert: "Expert",
  }[model];

  const canSubmit = (input.trim().length > 0 || attachments.length > 0) && !isLoading;

  const getAttachmentName = (att: PendingAttachment) => {
    return att.source === "file" ? att.file.name : att.existingFile.name;
  };

  const getAttachmentIsImage = (att: PendingAttachment) => {
    const mimeType = att.source === "file" ? att.file.type : att.existingFile.mimeType;
    return mimeType.startsWith("image/");
  };

  const availableExistingFiles = existingFiles.filter(
    (ef) => !attachments.some((att) => att.source === "existing" && att.existingFile.id === ef.id)
  );

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Removed overflow-hidden below so the absolute positioned popup isn't clipped */}
      <div
        className={cn(
          "relative bg-[#1a1a1a] border rounded-2xl shadow-lg transition-all duration-300",
          model === "expert"
            ? "border-[#4a6cf7]/65 shadow-[0_0_0_1px_rgba(74,108,247,0.16),0_0_22px_rgba(74,108,247,0.18)] focus-within:border-[#6d8cff] focus-within:shadow-[0_0_0_1px_rgba(74,108,247,0.3),0_0_28px_rgba(74,108,247,0.26)]"
            : "border-[#2a2a2a] focus-within:border-[#3a3a3a]"
        )}
      >
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-4">
            {attachments.map((att) => {
              const isImage = getAttachmentIsImage(att);
              return (
                <div
                  key={att.id}
                  className="relative group w-16 h-16 rounded-lg overflow-hidden border border-[#2a2a2a] bg-[#111] flex items-center justify-center"
                >
                  {isImage ? (
                    <img src={att.previewUrl} alt={getAttachmentName(att)} className="w-full h-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1 px-1">
                      <FileText className="w-5 h-5 text-[#888]" />
                      <span className="text-[9px] text-[#888] truncate w-full text-center">
                        {getAttachmentName(att)}
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
            "w-full bg-transparent text-white placeholder-[#555] px-4 pt-4 pb-2 resize-none focus:outline-none text-sm leading-relaxed min-h-[52px] max-h-[200px] rounded-t-2xl",
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

            {/* Attachment with dropdown */}
            <div className="relative" ref={dropdownRef}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={SUPPORTED_ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  onAddFiles(e.target.files);
                  e.target.value = "";
                  setFileDropdownOpen(false);
                }}
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => setFileDropdownOpen((v) => !v)}
                disabled={isLoading}
                className={cn(
                  "p-1.5 text-[#666] hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none rounded-lg",
                  fileDropdownOpen && "bg-white/10 text-white"
                )}
                aria-label="Attach file"
                title={SUPPORTED_ATTACHMENT_DESCRIPTION}
              >
                <Paperclip className="w-4 h-4" />
              </button>

              {/* File dropdown menu */}
              {fileDropdownOpen && (
                <div className="absolute left-0 bottom-full mb-2 z-40 w-64 rounded-2xl bg-[#16171d]/95 backdrop-blur-2xl shadow-2xl border border-white/10 p-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#ccc] hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <HardDrive className="w-4 h-4 text-[#888]" />
                    <span>Choose from device</span>
                  </button>

                  {availableExistingFiles.length > 0 && (
                    <>
                      <div className="my-1.5 h-px bg-white/10" />
                      <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#555a6d]">
                        Uploaded files
                      </div>
                      <div className="max-h-40 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                        {availableExistingFiles.map((file) => (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => {
                              onAttachExistingFile?.(file);
                              setFileDropdownOpen(false);
                            }}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#ccc] hover:bg-white/10 hover:text-white transition-colors"
                          >
                            {file.mimeType.startsWith("image/") ? (
                              <img
                                src={file.dataUrl}
                                alt={file.name}
                                className="w-5 h-5 rounded object-cover flex-shrink-0"
                              />
                            ) : (
                              <FileText className="w-4 h-4 text-[#888] flex-shrink-0" />
                            )}
                            <span className="truncate text-left flex-1">{file.name}</span>
                            <span className="text-[10px] text-[#555a6d] flex-shrink-0">
                              {(file.size / 1024).toFixed(0)}KB
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {availableExistingFiles.length === 0 && existingFiles.length > 0 && (
                    <>
                      <div className="my-1.5 h-px bg-white/10" />
                      <div className="px-3 py-2 text-[11px] text-[#555a6d] text-center">
                        All uploaded files are already attached
                      </div>
                    </>
                  )}

                  {existingFiles.length === 0 && (
                    <>
                      <div className="my-1.5 h-px bg-white/10" />
                      <div className="px-3 py-2 text-[11px] text-[#555a6d] text-center">
                        No uploaded files yet. Use "Upload files" in the sidebar.
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
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
        Join our Telegram channel: @NOVAPXP
      </p>
    </div>
  );
}