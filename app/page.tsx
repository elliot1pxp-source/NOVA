"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { NovaSidebar, Chat } from "@/components/nova-sidebar";
import { ChatView } from "@/components/chat-view";
import { cn } from "@/lib/utils";
import {
  loadChats,
  saveChats,
  clearAllChats,
  deleteChat,
  loadLastChatId,
  saveLastChatId,
  StoredChat,
  ModelSettings,
  loadModelSettings,
  saveModelSettings,
} from "@/lib/storage";
import { refreshPaidTierStatus } from "@/lib/paid-tier";
import { backupNow, clearBackup, flushBackup, restoreFromServer } from "@/lib/history-backup";

type Model = "instant" | "expert" | "coding";

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function toChat(s: StoredChat): Chat {
  return { id: s.id, title: s.title, createdAt: new Date(s.createdAt), pinned: s.pinned };
}

function toStored(c: Chat): StoredChat {
  return { id: c.id, title: c.title, createdAt: c.createdAt.toISOString(), pinned: c.pinned };
}

function dedupeChats(chats: Chat[]) {
  return Array.from(new Map(chats.map((chat) => [chat.id, chat])).values());
}

function isCopyableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("[data-chat-message]"));
}

// --- Chat URL helpers (client-side, no full page reload) ---
const CHAT_URL_PREFIX = "/chat/";

function getChatIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/chat\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function chatUrlFor(chatId: string | null): string {
  return chatId ? `${CHAT_URL_PREFIX}${chatId}` : "/";
}

function updateChatUrl(chatId: string | null, replace = false) {
  if (typeof window === "undefined") return;
  const url = chatUrlFor(chatId);
  if (window.location.pathname === url) return;
  if (replace) {
    window.history.replaceState({}, "", url);
  } else {
    window.history.pushState({}, "", url);
  }
}

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [model, setModel] = useState<Model>("instant");
  const [modelSettings, setModelSettings] = useState<ModelSettings>(loadModelSettings);
  const [pendingChatId, setPendingChatId] = useState<string>(() => generateId());
  const pendingChatIdRef = useRef<string>(pendingChatId);
  const hydratedRef = useRef(false);

  useEffect(() => {
    const stored = loadChats();
    let uniqueChats: Chat[] = [];
    if (stored.length > 0) {
      uniqueChats = dedupeChats(stored.map(toChat));
      setChats(uniqueChats);
      if (uniqueChats.length !== stored.length) {
        saveChats(uniqueChats.map(toStored));
      }
    }
    // If the URL points to a chat, open it; otherwise restore the last active
    // chat id — which may be an EMPTY, not-yet-committed chat (an empty chat
    // is still a real conversation and must survive a refresh). Never fall
    // back to an older chat just because the current one has no messages.
    const urlChatId = getChatIdFromUrl();
    const lastChatId = loadLastChatId();

    // WebViews (Telegram's in-app browser, etc.) can evict localStorage. When
    // the local store is empty, pull the server-side backup so the user does
    // not see their chats "disappear".
    if (uniqueChats.length === 0) {
      void restoreFromServer().then((restored) => {
        if (!restored || restored.chats.length === 0) return;
        const restoredChats = dedupeChats(restored.chats.map(toChat));
        setChats(restoredChats);
        const restoredLastId = restored.lastChatId ?? loadLastChatId();
        if (restoredLastId) {
          saveLastChatId(restoredLastId);
          if (restoredChats.some((c) => c.id === restoredLastId)) {
            setActiveChatId(restoredLastId);
            updateChatUrl(restoredLastId, true);
          } else {
            pendingChatIdRef.current = restoredLastId;
            setPendingChatId(restoredLastId);
          }
        }
      });
    }
    if (urlChatId && uniqueChats.some((chat) => chat.id === urlChatId)) {
      setActiveChatId(urlChatId);
      saveLastChatId(urlChatId);
    } else if (lastChatId) {
      if (uniqueChats.some((chat) => chat.id === lastChatId)) {
        // The last active chat exists in the list (even with zero messages).
        setActiveChatId(lastChatId);
        updateChatUrl(lastChatId, true);
      } else {
        // The last active chat was a fresh, empty chat that never received a
        // message — restore it as the pending chat so the user stays on it.
        pendingChatIdRef.current = lastChatId;
        setPendingChatId(lastChatId);
      }
    }
    hydratedRef.current = true;
  }, []);

  // Keep the URL in sync when the user navigates with the browser back/forward.
  useEffect(() => {
    const handlePopState = () => {
      const urlChatId = getChatIdFromUrl();
      if (urlChatId && chats.some((chat) => chat.id === urlChatId)) {
        setActiveChatId(urlChatId);
      } else {
        setActiveChatId(null);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [chats]);

  useEffect(() => {
    void refreshPaidTierStatus();
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    saveChats(dedupeChats(chats).map(toStored));
  }, [chats]);

  // Push the chat list + message history to the server backup whenever it
  // changes (debounced), and flush immediately when the page is hidden or
  // about to be unloaded (user switches to Telegram, tab gets killed, etc.).
  useEffect(() => {
    if (!hydratedRef.current) return;
    backupNow();
  }, [chats]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHide = () => flushBackup();
    document.addEventListener("visibilitychange", handleHide);
    window.addEventListener("pagehide", handleHide);
    window.addEventListener("beforeunload", handleHide);
    return () => {
      document.removeEventListener("visibilitychange", handleHide);
      window.removeEventListener("pagehide", handleHide);
      window.removeEventListener("beforeunload", handleHide);
    };
  }, []);

  const handleUpdateModelSettings = useCallback((newSettings: ModelSettings) => {
    setModelSettings(newSettings);
    saveModelSettings(newSettings);
  }, []);

  const handleNewChat = useCallback(() => {
    const nextId = generateId();
    pendingChatIdRef.current = nextId;
    setPendingChatId(nextId);
    // Persist the active chat id IMMEDIATELY so a refresh restores this new
    // (possibly empty) chat instead of an older one.
    saveLastChatId(nextId);
    setActiveChatId(null);
    updateChatUrl(null);
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    saveLastChatId(chatId);
    updateChatUrl(chatId);
  }, []);

  const handleFirstMessage = useCallback(
    (chatId: string, title: string) => {
      setChats((prev) => {
        const uniquePrev = dedupeChats(prev);
        const exists = uniquePrev.find((c) => c.id === chatId);
        if (exists) {
          return uniquePrev.map((c) => (c.id === chatId ? { ...c, title } : c));
        }
        return [{ id: chatId, title, createdAt: new Date() }, ...uniquePrev];
      });
      setActiveChatId(chatId);
      saveLastChatId(chatId);
      // The chat URL is only generated once a message is sent in a new chat.
      updateChatUrl(chatId);
    },
    []
  );

  const handleTogglePin = useCallback((chatId: string) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c)));
  }, []);

  const handleRenameChat = useCallback((chatId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setChats((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, title: trimmedTitle.slice(0, 100) } : chat
      )
    );
  }, []);

  const handleDeleteChat = useCallback((chatId: string) => {
    deleteChat(chatId);
    clearBackup(chatId);
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    setActiveChatId((current) => {
      if (current === chatId) {
        // The deleted chat was active — start a fresh pending chat and persist
        // its id so a refresh stays on the new empty chat.
        const nextId = generateId();
        pendingChatIdRef.current = nextId;
        setPendingChatId(nextId);
        saveLastChatId(nextId);
        updateChatUrl(null);
        return null;
      }
      return current;
    });
  }, []);

  const handleDeleteAllChats = useCallback(() => {
    clearAllChats();
    clearBackup();
    setChats([]);
    setActiveChatId(null);
    const nextId = generateId();
    pendingChatIdRef.current = nextId;
    setPendingChatId(nextId);
    saveLastChatId(nextId);
    updateChatUrl(null);
  }, []);

  const currentChatId = activeChatId ?? pendingChatIdRef.current;

  // Every chat's ChatView stays MOUNTED (hidden when not active) so that
  // in-flight assistant generations keep running in the background while the
  // user views another chat — switching chats is a display change, never a
  // cancellation. The pending (new) chat is mounted too; it only enters
  // `chats` after its first message is sent.
  const mountedChatIds = useMemo(() => {
    const ids = new Set(chats.map((c) => c.id));
    if (activeChatId === null) {
      ids.add(pendingChatIdRef.current);
    }
    return Array.from(ids);
  }, [chats, activeChatId, pendingChatId]);

  return (
    <div
      className="app-shell flex h-screen w-full overflow-hidden bg-[#0d0d0d]"
      onCopy={(event) => {
        if (!isCopyableTarget(event.target)) event.preventDefault();
      }}
      onDragStart={(event) => {
        if (event.target instanceof Element && event.target.closest("img")) {
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        if (event.target instanceof Element && event.target.closest("img")) {
          event.preventDefault();
        }
      }}
    >
      <NovaSidebar
        chats={chats}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onTogglePin={handleTogglePin}
        onRenameChat={handleRenameChat}
        onDeleteChat={handleDeleteChat}
        onDeleteAllChats={handleDeleteAllChats}
        modelSettings={modelSettings}
        onUpdateModelSettings={handleUpdateModelSettings}
      />
      <main className="flex flex-1 overflow-hidden">
        {mountedChatIds.map((chatId) => (
          <div
            key={chatId}
            className={cn("h-full w-full", chatId === currentChatId ? "" : "hidden")}
          >
            <ChatView
              chatId={chatId}
              model={model}
              modelSettings={modelSettings[model]}
              onModelChange={setModel}
              isActive={chatId === currentChatId}
              onFirstMessage={(title) => handleFirstMessage(chatId, title)}
            />
          </div>
        ))}
      </main>
    </div>
  );
}
