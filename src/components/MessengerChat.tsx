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
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const showInterim = !!(listening && interimTranscript && interimTranscript.trim().length > 0);

  const lumiMessages = messages.filter((m) => m.role === "lumi");
  const userMessages = messages.filter((m) => m.role === "user");

  useEffect(() => {
    leftRef.current?.scrollTo({ top: leftRef.current.scrollHeight, behavior: "smooth" });
    rightRef.current?.scrollTo({ top: rightRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, interimTranscript]);

  const fadeMask =
    "linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.2) 12%, rgba(0,0,0,0.85) 28%, #000 45%, #000 100%)";
  const columnStyle = {
    bottom: "120px",
    maxHeight: "65vh",
    width: "min(70vw, 720px)",
    WebkitMaskImage: fadeMask,
    maskImage: fadeMask,
  } as const;

  return (
    <>
      {/* Lumi column — left edge */}
      <div
        ref={leftRef}
        className="scrollbar-hide pointer-events-auto absolute left-3 z-10 flex flex-col gap-2 overflow-y-auto pt-12"
        style={columnStyle}
      >
        {lumiMessages.map((m) => (
          <Bubble key={m.id} role="lumi" content={m.content} />
        ))}
      </div>

      {/* User column — right edge */}
      <div
        ref={rightRef}
        className="scrollbar-hide pointer-events-auto absolute right-3 z-10 flex flex-col items-end gap-2 overflow-y-auto pt-12"
        style={columnStyle}
      >
        {userMessages.map((m) => (
          <Bubble key={m.id} role="user" content={m.content} />
        ))}
        {showInterim && <Bubble role="user" content={interimTranscript!} interim />}
      </div>
    </>
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
        className={`max-w-[85vw] rounded-3xl px-5 py-3 text-sm leading-relaxed shadow-[0_8px_28px_-16px_rgba(0,20,60,0.6)] backdrop-blur-xl sm:max-w-[70vw] md:max-w-[60vw] ${
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