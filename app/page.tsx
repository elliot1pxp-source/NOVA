"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NovaSidebar, Chat } from "@/components/nova-sidebar";
import { ChatView } from "@/components/chat-view";
import {
  loadChats,
  saveChats,
  clearAllChats,
  deleteChat,
  StoredChat,
  ModelSettings,
  loadModelSettings,
  saveModelSettings,
} from "@/lib/storage";
import { refreshPaidTierStatus } from "@/lib/paid-tier";

type Model = "instant" | "expert";

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
  const pendingChatIdRef = useRef<string>(generateId());
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
    // If the URL points to a chat, open it; otherwise start at a fresh chat.
    const urlChatId = getChatIdFromUrl();
    if (urlChatId && uniqueChats.some((chat) => chat.id === urlChatId)) {
      setActiveChatId(urlChatId);
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

  const handleUpdateModelSettings = useCallback((newSettings: ModelSettings) => {
    setModelSettings(newSettings);
    saveModelSettings(newSettings);
  }, []);

  const handleNewChat = useCallback(() => {
    pendingChatIdRef.current = generateId();
    setActiveChatId(null);
    updateChatUrl(null);
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
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
    setChats((prev) => prev.filter((chat) => chat.id !== chatId));
    setActiveChatId((current) => {
      if (current === chatId) {
        updateChatUrl(null);
        return null;
      }
      return current;
    });
  }, []);

  const handleDeleteAllChats = useCallback(() => {
    clearAllChats();
    setChats([]);
    setActiveChatId(null);
    pendingChatIdRef.current = generateId();
    updateChatUrl(null);
  }, []);

  const currentChatId = activeChatId ?? pendingChatIdRef.current;

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
        <ChatView
          key={currentChatId}
          chatId={currentChatId}
          model={model}
          modelSettings={modelSettings[model]}
          onModelChange={setModel}
          onFirstMessage={(title) => handleFirstMessage(currentChatId, title)}
        />
      </main>
    </div>
  );
}
