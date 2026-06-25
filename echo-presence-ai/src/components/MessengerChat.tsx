import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/types/pipeline";

interface MessengerChatProps {
  messages: ChatMessage[];
  interimTranscript?: string;
  listening?: boolean;
}

/**
 * Messenger-style conversation panel.
 *
 * Sits in a fixed region below Lumi's eyes — messages stream top to bottom,
 * Lumi on the left, user on the right. The panel is transparent so the face
 * stays visible behind it; bubbles use glassmorphism with low opacity.
 */
export function MessengerChat({ messages, interimTranscript, listening }: MessengerChatProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const showInterim = !!(listening && interimTranscript && interimTranscript.trim().length > 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, interimTranscript]);

  const fadeMask =
    "linear-gradient(to bottom, transparent 0%, #000 18%, #000 100%)";

  return (
    <div
      ref={scrollRef}
      className="scrollbar-hide pointer-events-auto absolute z-10 flex flex-col gap-[14px] overflow-y-auto px-2 pb-10 pt-6"
      style={{
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(88vw, 1000px)",
        bottom: "var(--lumi-chat-bottom, 140px)",
        height: "30vh",
        maxHeight: "320px",
        WebkitMaskImage: fadeMask,
        maskImage: fadeMask,
      }}
    >
      {messages.map((m) => (
        <Bubble key={m.id} role={m.role} content={m.content} />
      ))}
      {showInterim && <Bubble role="user" content={interimTranscript!} interim />}
    </div>
  );
}

function Bubble({
  role,
  content,
  interim,
}: {
  role: "user" | "lumi";
  content: string;
  interim?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[82%] rounded-3xl px-5 py-3 text-sm leading-relaxed shadow-[0_8px_28px_-16px_rgba(0,20,60,0.6)] backdrop-blur-xl md:max-w-[52%] ${
          isUser
            ? "bg-primary/55 text-primary-foreground rounded-br-md border border-primary/40"
            : "bg-white/10 text-foreground rounded-bl-md border border-white/15"
        } ${interim ? "opacity-70 italic" : "animate-fade-in"}`}
      >
        {content}
      </div>
    </div>
  );
}