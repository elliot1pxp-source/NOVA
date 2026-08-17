"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Image from "next/image";
import {
  Plus,
  Search,
  MoreHorizontal,
  Pin,
  PinOff,
  Settings,
  Trash2,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquare,
  X,
  Sparkles,
  Upload,
  FileText,
  ChevronDown,
  Crown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsDialog } from "@/components/settings-dialog";
import { PaidTierDialog } from "@/components/paid-tier-dialog";
import { ModelSettings, ChatFile, loadChatFiles, saveChatFiles, deleteChatFile, clearAllChatFiles } from "@/lib/storage";
import { getSupportedAttachmentMimeType, validateFileSize, validateAttachmentBatch, SUPPORTED_ATTACHMENT_ACCEPT } from "@/lib/attachments";
import { getPaidTierData, getServerMode, PAID_TIER_DIALOG_EVENT } from "@/lib/paid-tier";

export type Chat = {
  id: string;
  title: string;
  createdAt: Date;
  pinned?: boolean;
};

// Module-level flag that survives component remounts. Navigation between chat
// URLs remounts the page, so keeping the sidebar open state here prevents the
// sidebar from closing when creating/switching chats.
let sidebarHistoryOpenPersist = false;

type Props = {
  chats: Chat[];
  activeChatId: string | null;
  onNewChat: () => void;
  onSelectChat: (id: string) => void;
  onTogglePin: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onDeleteAllChats: () => void;
  modelSettings: ModelSettings;
  onUpdateModelSettings: (settings: ModelSettings) => void;
};

function groupChats(chats: Chat[]) {
  const pinned = chats.filter((c) => c.pinned);
  const now = new Date();
  const today: Chat[] = [];
  const yesterday: Chat[] = [];
  const sevenDays: Chat[] = [];
  const older: Chat[] = [];

  chats
    .filter((c) => !c.pinned)
    .forEach((c) => {
      const diff = (now.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (diff < 1) today.push(c);
      else if (diff < 2) yesterday.push(c);
      else if (diff <= 7) sevenDays.push(c);
      else older.push(c);
    });

  return { pinned, today, yesterday, sevenDays, older };
}

function ChatItem({
  chat,
  isActive,
  onClick,
  menuOpen,
  onToggleMenu,
  onTogglePin,
  onRename,
  onDelete,
}: {
  chat: Chat;
  isActive: boolean;
  onClick: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onTogglePin: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="relative group px-1 my-0.5">
      <button
        onClick={onClick}
        className={cn(
          "relative w-full text-left px-3.5 py-2.5 rounded-2xl text-xs font-medium transition-all duration-200 flex items-center gap-2.5 select-none",
          isActive
            ? "bg-white/10 text-white font-semibold"
            : "text-[#8c8f9c] hover:bg-white/[0.04] hover:text-white"
        )}
      >
        {isActive && (
          <span className="absolute left-1 top-2.5 bottom-2.5 w-1 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
        )}

        {chat.pinned ? (
          <Pin className="w-3.5 h-3.5 text-white flex-shrink-0" />
        ) : (
          <MessageSquare
            className={cn(
              "w-3.5 h-3.5 flex-shrink-0 transition-colors",
              isActive ? "text-white" : "text-[#5e616e] group-hover:text-white/80"
            )}
          />
        )}

        <span className="truncate flex-1 leading-snug">{chat.title}</span>

        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              onToggleMenu();
            }
          }}
          className={cn(
            "p-1 rounded-lg flex-shrink-0 transition-all duration-200 hover:bg-white/10 hover:text-white",
            menuOpen ? "opacity-100 bg-white/10 text-white" : "opacity-0 group-hover:opacity-70"
          )}
          aria-label="Chat options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </span>
      </button>

      {menuOpen && (
        <div className="absolute right-2 top-9 z-30 w-44 rounded-2xl bg-[#121216]/95 backdrop-blur-2xl border border-white/10 shadow-[0_12px_40px_rgba(0,0,0,0.8)] p-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-[#ccc] hover:bg-white/10 hover:text-white rounded-xl transition-colors font-medium"
          >
            <Pencil className="w-3.5 h-3.5 text-[#8c8f9c]" />
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-[#ccc] hover:bg-white/10 hover:text-white rounded-xl transition-colors font-medium"
          >
            {chat.pinned ? (
              <>
                <PinOff className="w-3.5 h-3.5 text-[#8c8f9c]" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 text-[#8c8f9c]" />
                Pin
              </>
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-950/40 rounded-xl transition-colors mt-1 font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ label, count }: { label: string; count?: number }) {
  return (
    <div className="px-3 pt-4 pb-1.5 flex items-center justify-between select-none">
      <span className="text-[10px] font-bold tracking-widest text-[#5e616e] uppercase">
        {label}
      </span>
      {count !== undefined && count > 0 && (
        <span className="text-[10px] font-mono text-[#4a4d5a] bg-white/[0.04] px-1.5 py-0.2 rounded-md">
          {count}
        </span>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function UploadFilesModal({
  chats,
  isOpen,
  onClose,
}: {
  chats: Chat[];
  isOpen: boolean;
  onClose: () => void;
}) {
  const [selectedChatId, setSelectedChatId] = useState<string>("");
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && selectedChatId) {
      setFiles(loadChatFiles(selectedChatId));
      setUploadError("");
    }
  }, [isOpen, selectedChatId]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, [dropdownOpen]);

  const handleFileChange = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || !selectedChatId) return;
      setUploadError("");
      setUploading(true);

      const selectedFiles = Array.from(fileList);

      // Keep the chat's file library from growing unbounded; a later message
      // can only embed a handful of files at once anyway.
      const batchCheck = validateAttachmentBatch(selectedFiles);
      if (!batchCheck.valid) {
        setUploadError(batchCheck.error || "Invalid files");
        setUploading(false);
        return;
      }

      const newFiles: ChatFile[] = [];
      for (const file of selectedFiles) {
        const validation = validateFileSize(file);
        if (!validation.valid) {
          setUploadError(validation.error || "Invalid file");
          setUploading(false);
          return;
        }

        const mimeType =
          getSupportedAttachmentMimeType({ mimeType: file.type, filename: file.name }) ||
          "application/octet-stream";

        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        newFiles.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          mimeType,
          size: file.size,
          dataUrl,
          createdAt: new Date().toISOString(),
        });
      }

      const existing = loadChatFiles(selectedChatId);
      const combined = [...existing, ...newFiles];
      saveChatFiles(selectedChatId, combined);
      setFiles(combined);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [selectedChatId]
  );

  const handleDeleteFile = useCallback(
    (fileId: string) => {
      if (!selectedChatId) return;
      deleteChatFile(selectedChatId, fileId);
      setFiles(loadChatFiles(selectedChatId));
    },
    [selectedChatId]
  );

  if (!isOpen) return null;

  const selectedChat = chats.find((c) => c.id === selectedChatId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md px-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-xl rounded-[28px] bg-[#0d0d11]/95 border border-white/10 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8c8f9c]">
          Upload Files
        </div>
        <div className="mb-4 text-xl font-semibold text-white">Manage Chat Files</div>

        <div className="mb-4">
          <label className="block text-xs font-medium text-[#8c8f9c] mb-2">
            Select a chat
          </label>
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              className="w-full flex items-center justify-between bg-white/[0.05] border border-white/10 rounded-2xl px-4 py-3 text-sm text-white hover:bg-white/[0.09] focus:outline-none transition-all text-left"
            >
              <span className={cn("truncate", !selectedChat && "text-[#5e616e]")}>
                {selectedChat ? selectedChat.title : "Choose a conversation…"}
              </span>
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-[#8c8f9c] transition-transform duration-200 flex-shrink-0 ml-2",
                  dropdownOpen && "rotate-180"
                )}
              />
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-2 z-50 max-h-80 overflow-y-auto rounded-2xl bg-[#141419]/98 border border-white/10 shadow-2xl backdrop-blur-2xl p-2 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150 scrollbar-thin scrollbar-thumb-white/20">
                {chats.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-[#5e616e] text-center">
                    No conversations available
                  </div>
                ) : (
                  chats.map((chat) => (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => {
                        setSelectedChatId(chat.id);
                        setDropdownOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm text-left transition-colors",
                        selectedChatId === chat.id
                          ? "bg-white/15 text-white font-medium"
                          : "text-[#ccc] hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <MessageSquare className="w-4 h-4 flex-shrink-0 text-[#8c8f9c]" />
                      <span className="truncate flex-1">{chat.title}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {selectedChatId && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={SUPPORTED_ATTACHMENT_ACCEPT}
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-2xl bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] text-xs font-medium text-[#8c8f9c] hover:text-white transition-all disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploading ? "Uploading…" : "Click to upload files to this chat"}
            </button>

            {uploadError && (
              <p className="mt-2 text-xs text-rose-400">{uploadError}</p>
            )}

            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#5e616e]">
                  Files in this chat
                </span>
                <span className="text-[10px] text-[#8c8f9c]">{files.length} file(s)</span>
              </div>

              {files.length === 0 ? (
                <div className="text-center py-6 text-xs text-[#5e616e] bg-white/[0.03] border border-white/5 rounded-2xl">
                  No files uploaded yet for this chat
                </div>
              ) : (
                <div className="space-y-1.5 max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 pr-1">
                  {files.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/5 hover:bg-white/[0.08] transition-colors group"
                    >
                      {file.mimeType.startsWith("image/") ? (
                        <img
                          src={file.dataUrl}
                          alt={file.name}
                          className="w-7 h-7 rounded-lg object-cover flex-shrink-0"
                        />
                      ) : (
                        <FileText className="w-4 h-4 text-[#8c8f9c] flex-shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-white truncate font-medium">{file.name}</div>
                        <div className="text-[10px] text-[#8c8f9c]">
                          {formatBytes(file.size)} · {file.mimeType}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteFile(file.id)}
                        className="p-1.5 rounded-lg text-[#8c8f9c] hover:text-rose-400 hover:bg-rose-950/40 transition-colors opacity-0 group-hover:opacity-100"
                        aria-label="Delete file"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {!selectedChatId && (
          <div className="text-center py-8 text-xs text-[#5e616e]">
            Select a chat above to manage its files
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-white text-black hover:bg-white/90 px-5 py-2 text-xs font-semibold transition-all active:scale-95 shadow-md"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function NovaSidebar({
  chats,
  activeChatId,
  onNewChat,
  onSelectChat,
  onTogglePin,
  onRenameChat,
  onDeleteChat,
  onDeleteAllChats,
  modelSettings,
  onUpdateModelSettings,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paidTierOpen, setPaidTierOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(sidebarHistoryOpenPersist);
  const [deletePendingChatId, setDeletePendingChatId] = useState<string | null>(null);
  const [uploadFilesOpen, setUploadFilesOpen] = useState(false);

  // Keep the module-level flag in sync so the open state survives remounts
  // caused by navigation between chat URLs.
  useEffect(() => {
    sidebarHistoryOpenPersist = historyOpen;
  }, [historyOpen]);

  // Open the paid tier dialog when any paid-gated feature is tapped elsewhere
  // in the app (e.g. High/Extra High reasoning in the chat input).
  useEffect(() => {
    const openDialog = () => setPaidTierOpen(true);
    window.addEventListener(PAID_TIER_DIALOG_EVENT, openDialog);
    return () => window.removeEventListener(PAID_TIER_DIALOG_EVENT, openDialog);
  }, []);

  const groups = groupChats(chats);
  // Gate paid-tier detection behind a mount flag: the values are read from
  // localStorage, which is unavailable during SSR. Without this, the server
  // render (always "Free Tier") diverges from the client's first render
  // (possibly "Paid Tier") and React throws a hydration mismatch. Both the
  // server and the client's first render use the SSR-safe default; after mount
  // the real value is computed. Kept as a derived value so later re-renders
  // (e.g. after redeeming a code) still reflect the current state.
  const [sidebarMounted, setSidebarMounted] = useState(false);
  useEffect(() => setSidebarMounted(true), []);
  const isPaidTierActive = sidebarMounted && getServerMode() === "paid" && getPaidTierData() !== null;
  const tierLabel = isPaidTierActive ? "Paid Tier" : "Free Tier";

  const openHistoryWithSearch = () => {
    setHistoryOpen(true);
    setSearchOpen(true);
    setMenuOpenId(null);
  };

  const openHistoryAndReset = () => {
    setHistoryOpen(true);
    setSearchOpen(false);
    setMenuOpenId(null);
  };

  const confirmDeleteChat = (chatId: string) => {
    setDeletePendingChatId(chatId);
    setMenuOpenId(null);
  };

  const cancelDelete = () => {
    setDeletePendingChatId(null);
  };

  const submitDeleteChat = () => {
    if (!deletePendingChatId) return;
    onDeleteChat(deletePendingChatId);
    setDeletePendingChatId(null);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onNewChat();
        openHistoryAndReset();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat]);

  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenId]);

  // Lock body scroll when sidebar is open on mobile
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = window.innerWidth < 768;
    if (!historyOpen || !isMobile) return;
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      window.scrollTo(0, scrollY);
    };
  }, [historyOpen]);

  const filtered = searchQuery.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  const renderList = (list: Chat[]) =>
    list.map((chat) => (
      <ChatItem
        key={chat.id}
        chat={chat}
        isActive={chat.id === activeChatId}
        onClick={() => {
          onSelectChat(chat.id);
          // On mobile screens, auto-close sidebar on chat select
          if (window.innerWidth < 768) {
            setHistoryOpen(false);
          }
        }}
        menuOpen={menuOpenId === chat.id}
        onToggleMenu={() => setMenuOpenId((id) => (id === chat.id ? null : chat.id))}
        onTogglePin={() => {
          onTogglePin(chat.id);
          setMenuOpenId(null);
        }}
        onRename={() => {
          const title = window.prompt("Rename chat", chat.title)?.trim();
          if (title) onRenameChat(chat.id, title);
          setMenuOpenId(null);
        }}
        onDelete={() => {
          confirmDeleteChat(chat.id);
        }}
      />
    ));

  return (
    <>
      {/* Persistent Floating Controls Button (Always rendered outside sidebar container when closed) */}
      {!historyOpen && (
        <div className="fixed right-4 top-4 md:left-4 z-40 flex items-center gap-1 animate-in fade-in duration-200">
          <div className="relative flex items-center gap-1 rounded-full bg-[#0a0a0c]/90 border border-white/15 p-1 shadow-2xl backdrop-blur-2xl">
            <button
              onClick={() => {
                setHistoryOpen(true);
                setSearchOpen(false);
                setMenuOpenId(null);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#8c8f9c] transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Open chat history"
              title="Open chat history"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <button
              onClick={openHistoryWithSearch}
              className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-[#8c8f9c] transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Search chats"
              title="Search chats"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                onNewChat();
                openHistoryAndReset();
              }}
              className="hidden sm:flex h-8 w-8 items-center justify-center rounded-full text-[#8c8f9c] transition-colors hover:bg-white/10 hover:text-white"
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Mobile Backdrop Overlay when sidebar is open */}
      {historyOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden animate-in fade-in duration-200"
          onClick={() => setHistoryOpen(false)}
          style={{ touchAction: "none" }}
        />
      )}

      {/* Main Sidebar Element */}
      <aside
        className={cn(
          "fixed md:relative inset-y-0 left-0 z-40 md:z-30 flex flex-col h-full bg-[#0a0a0c]/95 md:bg-[#0a0a0c]/90 border-r border-white/10 backdrop-blur-xl transition-all duration-300 ease-in-out select-none",
          historyOpen
            ? "w-[280px] min-w-[280px] translate-x-0"
            : "w-0 min-w-0 -translate-x-full md:translate-x-0 overflow-hidden border-none"
        )}
      >
        <div
          className={cn(
            "flex flex-col h-full w-[280px] transition-opacity duration-200 ease-in-out overflow-hidden",
            historyOpen ? "opacity-100 delay-100" : "opacity-0 pointer-events-none"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="relative group/logo">
                <Image src="/nova-logo.png" alt="NOVA" width={28} height={28} className="relative rounded-lg" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-white font-semibold text-sm tracking-wide">NOVA</span>
                <span
                  className={cn(
                    "text-[9px] font-bold px-1.5 py-0.5 rounded-md tracking-wider",
                    isPaidTierActive
                      ? "text-amber-300 bg-amber-500/15"
                      : "text-white/90 bg-white/15"
                  )}
                >
                  {tierLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className={cn(
                  "p-1.5 rounded-lg text-[#8c8f9c] hover:text-white hover:bg-white/10 transition-colors",
                  searchOpen && "bg-white/10 text-white"
                )}
                aria-label="Search chats"
                title="Search chats"
              >
                <Search className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  setHistoryOpen(false);
                  setSearchOpen(false);
                  setMenuOpenId(null);
                }}
                className="p-1.5 rounded-lg text-[#8c8f9c] hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close chat history"
                title="Close sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Action Buttons: New Chat & Upload */}
          <div className="px-3 pt-1 pb-2 space-y-1 flex-shrink-0">
            <button
              onClick={() => {
                onNewChat();
                openHistoryAndReset();
              }}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all duration-200 active:scale-[0.98]"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-5 h-5 rounded-lg bg-white text-black font-bold">
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
                <span className="font-semibold text-white">New chat</span>
              </div>
              <span className="text-[10px] text-white/70 font-mono bg-white/10 px-1.5 py-0.5 rounded-md">
                ⌘K
              </span>
            </button>

            <button
              onClick={() => setUploadFilesOpen(true)}
              className="w-full flex items-center justify-between px-3.5 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] text-[#8c8f9c] hover:text-white text-xs font-medium transition-all duration-200 active:scale-[0.98]"
            >
              <div className="flex items-center gap-2.5">
                <div className="p-1 rounded-md bg-white/5 text-[#8c8f9c] group-hover:text-white transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                </div>
                <span className="font-medium">Upload files</span>
              </div>
            </button>
          </div>

          {/* Search Input Bar */}
          {searchOpen && (
            <div className="px-3 pb-2 pt-1 flex-shrink-0 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#8c8f9c] absolute left-3 pointer-events-none" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search history..."
                  className="w-full bg-white/[0.05] focus:bg-white/[0.08] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#5e616e] focus:outline-none transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 text-[#8c8f9c] hover:text-white p-0.5 rounded-md"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Chat List */}
          <nav className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5 scrollbar-thin scrollbar-thumb-white/10">
            {filtered ? (
              filtered.length > 0 ? (
                renderList(filtered)
              ) : (
                <div className="px-4 py-8 text-center text-xs text-[#5e616e]">
                  No matching chats found
                </div>
              )
            ) : chats.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-[#5e616e] flex flex-col items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#3e414c]" />
                <span>No conversation history yet</span>
              </div>
            ) : (
              <>
                {groups.pinned.length > 0 && (
                  <>
                    <SectionLabel label="Pinned" count={groups.pinned.length} />
                    {renderList(groups.pinned)}
                  </>
                )}
                {groups.today.length > 0 && (
                  <>
                    <SectionLabel label="Today" count={groups.today.length} />
                    {renderList(groups.today)}
                  </>
                )}
                {groups.yesterday.length > 0 && (
                  <>
                    <SectionLabel label="Yesterday" count={groups.yesterday.length} />
                    {renderList(groups.yesterday)}
                  </>
                )}
                {groups.sevenDays.length > 0 && (
                  <>
                    <SectionLabel label="7 Days" count={groups.sevenDays.length} />
                    {renderList(groups.sevenDays)}
                  </>
                )}
                {groups.older.length > 0 && (
                  <>
                    <SectionLabel label="Older" count={groups.older.length} />
                    {renderList(groups.older)}
                  </>
                )}
              </>
            )}
          </nav>

          {/* Footer (Paid Tier & Settings) */}
          <div className="p-3 flex-shrink-0 space-y-0.5">
            <button
              onClick={() => setPaidTierOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-[#8c8f9c] hover:text-amber-400 hover:bg-amber-500/10 transition-colors text-xs font-medium"
              aria-label="Paid Tier"
              title="Paid Tier"
            >
              <Crown className="w-4 h-4" />
              <span>Paid Tier</span>
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-[#8c8f9c] hover:text-white hover:bg-white/10 transition-colors text-xs font-medium"
              aria-label="Settings"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Upload Files Modal */}
      <UploadFilesModal
        chats={chats}
        isOpen={uploadFilesOpen}
        onClose={() => setUploadFilesOpen(false)}
      />

      {/* Paid Tier Dialog Modal */}
      <PaidTierDialog
        isOpen={paidTierOpen}
        onClose={() => setPaidTierOpen(false)}
      />

      {/* Settings Dialog Modal */}
      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={modelSettings}
        onUpdateSettings={onUpdateModelSettings}
        onDeleteAllChats={onDeleteAllChats}
        onDeleteAllFiles={() => clearAllChatFiles()}
      />

      {/* Delete Chat Modal */}
      {deletePendingChatId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md px-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          onClick={cancelDelete}
        >
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-[28px] bg-[#0d0d11]/95 border border-white/10 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.9)] backdrop-blur-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#8c8f9c]">
              Delete Chat
            </div>
            <div className="mb-3 text-lg font-semibold text-white">Delete this chat?</div>
            <p className="mb-6 text-xs leading-relaxed text-[#8c8f9c]">
              This will permanently remove this conversation history and all its uploaded files.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={cancelDelete}
                className="rounded-full bg-white/5 px-4 py-2 text-xs font-medium text-[#ccc] hover:bg-white/10 hover:text-white transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDeleteChat}
                className="rounded-full bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 shadow-lg shadow-rose-950/50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}