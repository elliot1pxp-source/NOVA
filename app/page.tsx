"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NovaSidebar, Chat } from "@/components/nova-sidebar";
import { ChatView } from "@/components/chat-view";
import { loadChats, saveChats, clearAllChats, deleteChat, StoredChat } from "@/lib/storage";

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

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [model, setModel] = useState<Model>("instant");
  // Stable ID for the "new chat" session that persists until user navigates away
  const pendingChatIdRef = useRef<string>(generateId());
  const hydratedRef = useRef(false);

  // Load chat list + pin state from localStorage on first mount.
  useEffect(() => {
    const stored = loadChats();
    if (stored.length > 0) {
      setChats(stored.map(toChat));
    }
    hydratedRef.current = true;
  }, []);

  // Persist the chat list (titles + pin state) any time it changes.
  useEffect(() => {
    if (!hydratedRef.current) return;
    saveChats(chats.map(toStored));
  }, [chats]);

  const handleNewChat = useCallback(() => {
    // Generate a fresh pending ID for the new session
    pendingChatIdRef.current = generateId();
    setActiveChatId(null);
  }, []);

  // Called when the user sends their first message in a pending chat
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

  // If there's an active chat selected from sidebar, use it.
  // Otherwise use the stable pending ID so the session persists while typing.
  const currentChatId = activeChatId ?? pendingChatIdRef.current;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0d0d0d]">
    <NovaSidebar
    chats={chats}
    activeChatId={activeChatId}
    onNewChat={handleNewChat}
    onSelectChat={setActiveChatId}
    onTogglePin={handleTogglePin}
    onRenameChat={handleRenameChat}
    onDeleteChat={handleDeleteChat}
    onDeleteAllChats={handleDeleteAllChats}
    />
    <main className="flex flex-1 overflow-hidden">
    <ChatView
    key={currentChatId}
    chatId={currentChatId}
    model={model}
    onModelChange={setModel}
    onFirstMessage={(title) => handleFirstMessage(currentChatId, title)}
    />
    </main>
    </div>
  );
}
