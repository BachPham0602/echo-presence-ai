import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "@/types/pipeline";

/**
 * Conversation persistence store.
 *
 * Lightweight localStorage-backed store for chat history. Designed so the
 * storage layer can later be swapped to Lovable Cloud / a server without
 * touching the UI: every consumer talks to the hook below.
 */

const STORAGE_KEY = "lumi.conversations.v1";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

interface ConversationStoreState {
  conversations: Conversation[];
  activeId: string | null;
}

const emptyState: ConversationStoreState = {
  conversations: [],
  activeId: null,
};

function load(): ConversationStoreState {
  if (typeof window === "undefined") return emptyState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw) as ConversationStoreState;
    return {
      conversations: parsed.conversations ?? [],
      activeId: null, // each visit starts a fresh conversation
    };
  } catch {
    return emptyState;
  }
}

function persist(state: ConversationStoreState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "Đoạn hội thoại mới";
  const t = first.content.trim().replace(/\s+/g, " ");
  return t.length > 36 ? `${t.slice(0, 36)}…` : t;
}

export function groupByDay(
  conversations: Conversation[],
): Array<{ label: string; items: Conversation[] }> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const buckets: Record<string, Conversation[]> = {
    "Hôm nay": [],
    "Hôm qua": [],
    "Trước đó": [],
  };
  for (const c of conversations) {
    const d = new Date(c.updatedAt);
    if (d >= today) buckets["Hôm nay"].push(c);
    else if (d >= yesterday) buckets["Hôm qua"].push(c);
    else buckets["Trước đó"].push(c);
  }
  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({
      label,
      items: items.sort((a, b) => b.updatedAt - a.updatedAt),
    }));
}

export interface UseConversationsResult {
  conversations: Conversation[];
  activeId: string | null;
  activeMessages: ChatMessage[];
  startNewConversation: () => string;
  selectConversation: (id: string) => ChatMessage[];
  appendMessage: (message: ChatMessage) => void;
  deleteConversation: (id: string) => void;
}

export function useConversations(): UseConversationsResult {
  const [state, setState] = useState<ConversationStoreState>(emptyState);

  useEffect(() => {
    setState(load());
  }, []);

  useEffect(() => {
    persist(state);
  }, [state]);

  const startNewConversation = useCallback(() => {
    const id = makeId();
    setState((prev) => ({
      conversations: [
        {
          id,
          title: "Đoạn hội thoại mới",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: [],
        },
        ...prev.conversations,
      ],
      activeId: id,
    }));
    return id;
  }, []);

  const selectConversation = useCallback(
    (id: string): ChatMessage[] => {
      const conv = state.conversations.find((c) => c.id === id);
      setState((prev) => ({ ...prev, activeId: id }));
      return conv?.messages ?? [];
    },
    [state.conversations],
  );

  const appendMessage = useCallback((message: ChatMessage) => {
    setState((prev) => {
      let activeId = prev.activeId;
      let conversations = prev.conversations;
      if (!activeId) {
        activeId = makeId();
        conversations = [
          {
            id: activeId,
            title: "Đoạn hội thoại mới",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [],
          },
          ...conversations,
        ];
      }
      conversations = conversations.map((c) => {
        if (c.id !== activeId) return c;
        const messages = [...c.messages, message];
        return {
          ...c,
          messages,
          updatedAt: Date.now(),
          title:
            c.title === "Đoạn hội thoại mới" && message.role === "user"
              ? titleFromMessages(messages)
              : c.title,
        };
      });
      return { conversations, activeId };
    });
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setState((prev) => ({
      conversations: prev.conversations.filter((c) => c.id !== id),
      activeId: prev.activeId === id ? null : prev.activeId,
    }));
  }, []);

  const activeMessages =
    state.conversations.find((c) => c.id === state.activeId)?.messages ?? [];

  return {
    conversations: state.conversations,
    activeId: state.activeId,
    activeMessages,
    startNewConversation,
    selectConversation,
    appendMessage,
    deleteConversation,
  };
}