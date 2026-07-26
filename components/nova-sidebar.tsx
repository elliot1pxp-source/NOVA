"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Plus, Search, MoreHorizontal, Pin, PinOff, Settings, Trash2, Pencil, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";

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
    <div className="relative">
      <button
        onClick={onClick}
        className={cn(
          "group w-full text-left px-3 py-2 rounded-lg text-sm transition-colors truncate flex items-center gap-2",
          isActive
            ? "bg-[#2a2a2a] text-white"
            : "text-[#8a8a8a] hover:bg-[#1e1e1e] hover:text-white"
        )}
      >
        {chat.pinned && <Pin className="w-3 h-3 text-[#4a6cf7] flex-shrink-0" />}
        <span className="truncate flex-1">{chat.title}</span>
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
            "p-0.5 rounded flex-shrink-0 transition-opacity hover:bg-[#333]",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-60"
          )}
        >
          <MoreHorizontal className="w-4 h-4" />
        </span>
      </button>

      {menuOpen && (
        <div className="absolute right-1 top-9 z-20 w-36 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] shadow-xl py-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#252525] hover:text-white transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
            Rename
          </button>
          <button
        onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#ccc] hover:bg-[#252525] hover:text-white transition-colors"
        >
        {chat.pinned ? (
              <>
              <PinOff className="w-3.5 h-3.5" />
              Unpin
              </>
        ) : (
              <>
              <Pin className="w-3.5 h-3.5" />
              Pin
              </>
        )}
        </button>
        <button
        onClick={(e) => {
              e.stopPropagation();
              onDelete();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#e87070] hover:bg-[#252525] transition-colors"
        >
        <Trash2 className="w-3.5 h-3.5" />
        Delete
        </button>
        </div>
      )}    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <p className="px-3 pt-3 pb-1 text-xs font-medium text-[#555]">{label}</p>
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
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [deletePendingChatId, setDeletePendingChatId] = useState<string | null>(null);
  const [deleteAllPending, setDeleteAllPending] = useState(false);
  const groups = groupChats(chats);

  const openHistoryWithSearch = () => {
    setHistoryOpen(true);
    setSearchOpen(true);
    setMenuOpenId(null);
    setSettingsOpen(false);
  };

  const openHistoryAndReset = () => {
    setHistoryOpen(true);
    setSearchOpen(false);
    setMenuOpenId(null);
    setSettingsOpen(false);
  };

  const confirmDeleteChat = (chatId: string) => {
    setDeletePendingChatId(chatId);
    setMenuOpenId(null);
  };

  const cancelDelete = () => {
    setDeletePendingChatId(null);
    setDeleteAllPending(false);
  };

  const submitDeleteChat = () => {
    if (!deletePendingChatId) return;
    onDeleteChat(deletePendingChatId);
    setDeletePendingChatId(null);
  };

  const submitDeleteAllChats = () => {
    setDeleteAllPending(false);
    onDeleteAllChats();
  };

  // Close the pin menu / settings menu when clicking anywhere else
  useEffect(() => {
    if (!menuOpenId && !settingsOpen) return;
    const close = () => {
      setMenuOpenId(null);
      setSettingsOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenId, settingsOpen]);

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
        "relative flex flex-col h-full bg-[#111] transition-[width] duration-200 ease-out",
        historyOpen
          ? "overflow-hidden w-[220px] min-w-[220px] border-r border-[#1e1e1e]"
          : "overflow-visible w-0 min-w-0 border-r-0"
      )}
    >
      {/* Logo / Closed Floating Controls */}
      {historyOpen ? (
        <div className="flex items-center gap-2 px-4 py-4">
          <Image src="/nova-logo.png" alt="NOVA" width={28} height={28} className="rounded-md" />
          <span className="text-white font-semibold text-base tracking-wide">NOVA</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setSearchOpen((v) => !v)}
              className="p-1.5 rounded-md text-[#555] hover:text-white hover:bg-[#1e1e1e] transition-colors"
              aria-label="Search chats"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setHistoryOpen((open) => !open);
                setSearchOpen(false);
                setMenuOpenId(null);
                setSettingsOpen(false);
              }}
              className="p-1.5 rounded-md text-[#555] hover:text-white hover:bg-[#1e1e1e] transition-colors"
              aria-label="Close chat history"
              title="Close chat history"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-3 top-3 z-30 flex items-center gap-0.5 rounded-full border border-[#2a2a2a] bg-[#111] p-1 shadow-md">
            <button
              onClick={() => {
                setHistoryOpen(true);
                setSearchOpen(false);
                setMenuOpenId(null);
                setSettingsOpen(false);
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#999] transition-colors hover:bg-[#1e1e1e] hover:text-white"
              aria-label="Open chat history"
              title="Open chat history"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={openHistoryWithSearch}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#999] transition-colors hover:bg-[#1e1e1e] hover:text-white"
              aria-label="Search chats"
              title="Search chats"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                onNewChat();
                openHistoryAndReset();
              }}
              className="flex h-7 w-7 items-center justify-center rounded-full text-[#999] transition-colors hover:bg-[#1e1e1e] hover:text-white"
              aria-label="New chat"
              title="New chat"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {historyOpen && (
        <>
          {/* New Chat Button */}
          <div className="px-3 pb-3">
            <button
              onClick={onNewChat}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2a2a2a] text-[#aaa] hover:text-white hover:border-[#3a3a3a] hover:bg-[#1a1a1a] transition-all text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New chat</span>
            </button>
          </div>

          {/* Search Input */}
          {searchOpen && (
            <div className="px-3 pb-2">
              <input
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-3 py-1.5 text-sm text-white placeholder-[#555] focus:outline-none focus:border-[#3a3a3a]"
              />
            </div>
          )}

          {/* Chat List */}
          <nav className="flex-1 overflow-y-auto px-1 pb-4 scrollbar-thin">
            {filtered ? (
              filtered.length > 0 ? (
                renderList(filtered)
              ) : (
                <p className="text-xs text-[#555] px-3 py-4">No results found.</p>
              )
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

          {/* Settings Footer */}
          <div className="relative px-3 py-3 border-t border-[#1e1e1e]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSettingsOpen((v) => !v);
              }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-[#1a1a1a] text-[#aaa] hover:text-white transition-colors"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm flex-1 text-left">Settings</span>
            </button>

            {settingsOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-14 left-3 right-3 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] shadow-xl py-1 z-20"
              >
                <button
                  onClick={() => {
                    setSettingsOpen(false);
                    setDeleteAllPending(true);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[#e87070] hover:bg-[#252525] transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete all chat history
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </aside>

    {(deletePendingChatId || deleteAllPending) && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deleteChatDialogTitle"
      >
        <div className="relative w-full max-w-sm overflow-hidden rounded-[32px] border border-white/10 bg-white/10 p-6 shadow-2xl shadow-black/35 backdrop-blur-3xl">
          <div className="pointer-events-none absolute -top-4 right-4 h-14 w-14 rounded-full bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.18)] backdrop-blur-xl" />
          <div className="mb-4 text-sm font-semibold uppercase tracking-[0.25em] text-[#bfc9d8]">
            {deleteAllPending ? "Delete all history" : "Delete chat"}
          </div>
          <div id="deleteChatDialogTitle" className="mb-4 text-xl font-semibold text-white">
            {deleteAllPending ? "Delete all chat history?" : "Delete this chat?"}
          </div>
          <p className="mb-6 text-sm leading-6 text-[#d2dce8]">
            {deleteAllPending
              ? "This will permanently remove every chat and its message history. This action cannot be undone."
              : "This will permanently remove the selected chat and its message history. This action cannot be undone."}
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={cancelDelete}
              className="rounded-2xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-[#c7d0e0] transition hover:border-white/20 hover:bg-white/15"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteAllPending ? submitDeleteAllChats : submitDeleteChat}
              className="rounded-2xl bg-[#df4d66] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#ff5a76]"
            >
              {deleteAllPending ? "Delete all chats" : "Delete chat"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
