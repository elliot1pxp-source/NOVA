"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsDialog } from "@/components/settings-dialog";
import { ModelSettings } from "@/lib/storage";

export type Chat = {
  id: string;
  title: string;
  createdAt: Date;
  pinned?: boolean;
};

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
    <div className="relative group px-1">
      <button
        onClick={onClick}
        className={cn(
          "relative w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex items-center gap-2.5 select-none",
          isActive
            ? "bg-[#4a6cf7]/15 text-white"
            : "text-[#888c99] hover:bg-white/[0.04] hover:text-[#e1e4ed]"
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#4a6cf7]" />
        )}

        {chat.pinned ? (
          <Pin className="w-3.5 h-3.5 text-[#4a6cf7] flex-shrink-0" />
        ) : (
          <MessageSquare
            className={cn(
              "w-3.5 h-3.5 flex-shrink-0 transition-colors",
              isActive ? "text-[#7d99ff]" : "text-[#555a68] group-hover:text-[#888c99]"
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
            "p-1 rounded-lg flex-shrink-0 transition-all duration-150 hover:bg-white/10 hover:text-white",
            menuOpen ? "opacity-100 bg-white/10 text-white" : "opacity-0 group-hover:opacity-70"
          )}
          aria-label="Chat options"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </span>
      </button>

      {menuOpen && (
        <div className="absolute right-2 top-9 z-30 w-40 rounded-2xl bg-[#16171d]/95 backdrop-blur-2xl shadow-2xl p-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-[#ccc] hover:bg-white/10 hover:text-white rounded-xl transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 text-[#888]" />
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-[#ccc] hover:bg-white/10 hover:text-white rounded-xl transition-colors"
          >
            {chat.pinned ? (
              <>
                <PinOff className="w-3.5 h-3.5 text-[#888]" />
                Unpin
              </>
            ) : (
              <>
                <Pin className="w-3.5 h-3.5 text-[#888]" />
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
            className="w-full flex items-center gap-2.5 px-2.5 py-1.5 text-xs text-[#f87171] hover:bg-[#2a1416] rounded-xl transition-colors mt-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-4 pb-1">
      <span className="text-[10px] font-bold tracking-wider text-[#505462] uppercase">
        {label}
      </span>
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
  const [historyOpen, setHistoryOpen] = useState(true);
  const [deletePendingChatId, setDeletePendingChatId] = useState<string | null>(null);

  const groups = groupChats(chats);

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

  const filtered = searchQuery.trim()
    ? chats.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : null;

  const renderList = (list: Chat[]) =>
    list.map((chat) => (
      <ChatItem
        key={chat.id}
        chat={chat}
        isActive={chat.id === activeChatId}
        onClick={() => onSelectChat(chat.id)}
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
      <aside
        className={cn(
          "relative flex flex-col h-full bg-[#0c0d10] transition-all duration-300 ease-in-out select-none",
          historyOpen ? "w-[250px] min-w-[250px]" : "w-0 min-w-0"
        )}
      >
        <div
          className={cn(
            "absolute left-3 top-3 z-30 flex items-center gap-1 rounded-full bg-[#121318]/90 p-1 shadow-2xl shadow-black/80 backdrop-blur-2xl transition-all duration-300 ease-in-out",
            historyOpen
              ? "opacity-0 scale-90 pointer-events-none -translate-x-2"
              : "opacity-100 scale-100 pointer-events-auto translate-x-0"
          )}
        >
          <button
            onClick={() => {
              setHistoryOpen(true);
              setSearchOpen(false);
              setMenuOpenId(null);
            }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#aaa] transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Open chat history"
            title="Open chat history"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
          <button
            onClick={openHistoryWithSearch}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#aaa] transition-colors hover:bg-white/10 hover:text-white"
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
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#aaa] transition-colors hover:bg-white/10 hover:text-white"
            aria-label="New chat"
            title="New chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div
          className={cn(
            "flex flex-col h-full w-[250px] transition-opacity duration-200 ease-in-out overflow-hidden",
            historyOpen ? "opacity-100 delay-100" : "opacity-0 pointer-events-none"
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="relative p-0.5 rounded-lg bg-[#181920]">
                <Image src="/nova-logo.png" alt="NOVA" width={22} height={22} className="rounded-md" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-white font-semibold text-sm tracking-wide">NOVA</span>
                <span className="text-[10px] font-bold text-[#4a6cf7] bg-[#4a6cf7]/15 px-1.5 py-0.5 rounded-md">
                  UNCENSORED
                </span>
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setSearchOpen((v) => !v)}
                className={cn(
                  "p-1.5 rounded-lg text-[#777b8e] hover:text-white hover:bg-white/10 transition-colors",
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
                className="p-1.5 rounded-lg text-[#777b8e] hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Close chat history"
                title="Close sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* New Chat Button */}
          <div className="px-3 py-2 flex-shrink-0">
            <button
              onClick={() => {
                onNewChat();
                openHistoryAndReset();
              }}
              className="group relative w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-gradient-to-r from-[#4a6cf7]/20 via-[#4a6cf7]/10 to-transparent hover:from-[#4a6cf7]/30 hover:via-[#4a6cf7]/15 hover:to-transparent text-white text-xs font-medium transition-all duration-200 active:scale-[0.98]"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center w-5 h-5 rounded-lg bg-[#4a6cf7] text-white shadow-[0_0_12px_rgba(74,108,247,0.4)] group-hover:scale-105 transition-transform">
                  <Plus className="w-3.5 h-3.5" />
                </div>
                <span className="font-medium text-white/90">New chat</span>
              </div>
              <span className="text-[10px] text-[#6b7280] font-mono bg-white/[0.04] px-1.5 py-0.5 rounded-md">
                ⌘K
              </span>
            </button>
          </div>

          {searchOpen && (
            <div className="px-3 pb-2 pt-1 flex-shrink-0 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-[#555a6d] absolute left-3 pointer-events-none" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search history..."
                  className="w-full bg-white/[0.03] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-[#555a6d] focus:outline-none focus:bg-white/[0.06] transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 text-[#666] hover:text-white p-0.5 rounded-md"
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
                <div className="px-4 py-8 text-center text-xs text-[#555a6d]">
                  No matching chats found
                </div>
              )
            ) : chats.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-[#555a6d] flex flex-col items-center gap-2">
                <Sparkles className="w-5 h-5 text-[#333742]" />
                <span>No conversation history yet</span>
              </div>
            ) : (
              <>
                {groups.pinned.length > 0 && (
                  <>
                    <SectionLabel label="Pinned" />
                    {renderList(groups.pinned)}
                  </>
                )}
                {groups.today.length > 0 && (
                  <>
                    <SectionLabel label="Today" />
                    {renderList(groups.today)}
                  </>
                )}
                {groups.yesterday.length > 0 && (
                  <>
                    <SectionLabel label="Yesterday" />
                    {renderList(groups.yesterday)}
                  </>
                )}
                {groups.sevenDays.length > 0 && (
                  <>
                    <SectionLabel label="7 Days" />
                    {renderList(groups.sevenDays)}
                  </>
                )}
                {groups.older.length > 0 && (
                  <>
                    <SectionLabel label="Older" />
                    {renderList(groups.older)}
                  </>
                )}
              </>
            )}
          </nav>

          {/* Footer Settings Button */}
          <div className="relative px-3 py-3 flex-shrink-0 border-t border-white/5">
            <button
              onClick={() => setSettingsOpen(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/[0.04] text-[#888c99] hover:text-white transition-all text-xs font-medium"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4 text-[#666a7a]" />
              <span className="flex-1 text-left">Settings</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Liquid Glass Settings Dialog Modal */}
      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={modelSettings}
        onUpdateSettings={onUpdateModelSettings}
        onDeleteAllChats={onDeleteAllChats}
      />

      {/* Delete Chat Modal */}
      {deletePendingChatId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md px-4 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          onClick={cancelDelete}
        >
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-3xl bg-[#14151b]/95 p-6 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[#4a6cf7]">
              Delete Chat
            </div>
            <div className="mb-3 text-lg font-semibold text-white">Delete this chat?</div>
            <p className="mb-6 text-xs leading-relaxed text-[#888c99]">
              This will permanently remove this conversation history.
            </p>
            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={cancelDelete}
                className="rounded-xl bg-white/5 px-4 py-2 text-xs font-medium text-[#ccc] hover:bg-white/10 hover:text-white transition-all active:scale-95"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDeleteChat}
                className="rounded-xl bg-[#e11d48] hover:bg-[#f43f5e] px-4 py-2 text-xs font-semibold text-white transition-all active:scale-95 shadow-lg shadow-rose-950/40"
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