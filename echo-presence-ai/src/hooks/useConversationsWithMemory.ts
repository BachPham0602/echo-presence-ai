import { useCallback } from "react";

import { endLumiSession } from "@/ai/userMemory";
import { getCurrentApiSessionId, setCurrentApiSessionId } from "@/store/lumiSessionRegistry";
import { useConversations } from "@/store/conversations";

/**
 * Drop-in replacement for useConversations that notifies user-memory on session changes.
 */
export function useConversationsWithMemory() {
  const base = useConversations();

  const endCurrentSession = useCallback((reason: "new_chat" | "switch" | "session_end") => {
    void endLumiSession(getCurrentApiSessionId(), reason);
  }, []);

  const startNewConversation = useCallback(() => {
    endCurrentSession("new_chat");
    const id = base.startNewConversation();
    setCurrentApiSessionId(id);
    return id;
  }, [base, endCurrentSession]);

  const selectConversation = useCallback(
    (id: string) => {
      endCurrentSession("switch");
      const msgs = base.selectConversation(id);
      setCurrentApiSessionId(id);
      return msgs;
    },
    [base, endCurrentSession],
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (id === base.activeId) {
        endCurrentSession("session_end");
      }
      base.deleteConversation(id);
    },
    [base, endCurrentSession],
  );

  return {
    ...base,
    startNewConversation,
    selectConversation,
    deleteConversation,
  };
}
