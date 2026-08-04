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

function isCopyableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest('[data-chat-message], input, textarea, [contenteditable="true"]')
  );
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
    if (stored.length > 0) {
      setChats(stored.map(toChat));
    }
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    void refreshPaidTierStatus();
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    saveChats(chats.map(toStored));
  }, [chats]);

  const handleUpdateModelSettings = useCallback((newSettings: ModelSettings) => {
    setModelSettings(newSettings);
    saveModelSettings(newSettings);
  }, []);

  const handleNewChat = useCallback(() => {
    pendingChatIdRef.current = generateId();
    setActiveChatId(null);
  }, []);

  const handleFirstMessage = useCallback(
    (chatId: string, title: string) => {
      setChats((prev) => {
        const exists = prev.find((c) => c.id === chatId);
        if (exists) {
          return prev.map((c) => (c.id === chatId ? { ...c, title } : c));
        }
        return [{ id: chatId, title, createdAt: new Date() }, ...prev];
      });
      setActiveChatId(chatId);
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
    setActiveChatId((current) => (current === chatId ? null : current));
  }, []);

  const handleDeleteAllChats = useCallback(() => {
    clearAllChats();
    setChats([]);
    setActiveChatId(null);
    pendingChatIdRef.current = generateId();
  }, []);

  const currentChatId = activeChatId ?? pendingChatIdRef.current;

  return (
    <div
      className="app-shell flex h-screen w-full overflow-hidden bg-[#0d0d0d]"
      onCopy={(event) => {
        if (!isCopyableTarget(event.target)) event.preventDefault();
      }}
      onDragStart={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("img") &&
          !isCopyableTarget(event.target)
        ) {
          event.preventDefault();
        }
      }}
      onContextMenu={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("img") &&
          !isCopyableTarget(event.target)
        ) {
          event.preventDefault();
        }
      }}
    >
      <NovaSidebar
        chats={chats}
        activeChatId={activeChatId}
        onNewChat={handleNewChat}
        onSelectChat={setActiveChatId}
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
