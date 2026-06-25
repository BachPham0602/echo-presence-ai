import { useEffect, useRef, useState, type FormEvent } from "react";
import { Send, X } from "lucide-react";
import type { ChatMessage } from "@/types/pipeline";

interface ChatOverlayProps {
  open: boolean;
  messages: ChatMessage[];
  onSend: (text: string) => void;
  onClose: () => void;
  interimTranscript?: string;
}

export function ChatOverlay({
  open,
  messages,
  onSend,
  onClose,
  interimTranscript,
}: ChatOverlayProps) {
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [open, messages.length]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSend(value);
    setValue("");
  };

  const recent = [...messages.slice(-4)];
  if (interimTranscript) {
    recent.push({
      id: "interim-transcript",
      role: "user",
      content: interimTranscript,
      timestamp: Date.now(),
    });
  }

  return (
    <>
      {/* Always-visible recent bubbles — minimal, blurred, secondary to the face */}
      <div className="pointer-events-none absolute inset-x-0 top-24 z-10 flex flex-col items-center gap-2 px-4">
        {recent.map((m) => (
          <div
            key={m.id}
            className={`glass-bubble max-w-md animate-fade-in text-sm ${
              m.role === "user" ? "text-foreground/85" : "text-foreground"
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>

      {/* Full text-fallback panel — hidden until needed */}
      {open && (
        <div className="absolute inset-x-0 bottom-32 z-30 flex justify-center px-4 animate-fade-in">
          <div className="glass-panel w-full max-w-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Trò chuyện bằng chữ
              </span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="rounded-full p-1 text-muted-foreground transition hover:bg-foreground/5"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div ref={scrollRef} className="mb-3 max-h-48 space-y-2 overflow-y-auto pr-1">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Bạn có thể gõ vài chữ, Lumi vẫn luôn lắng nghe.
                </p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`glass-bubble max-w-[80%] text-sm ${
                      m.role === "user" ? "bg-primary/15 text-foreground" : "text-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="flex items-center gap-2">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Bạn muốn kể Lumi nghe điều gì?"
                className="flex-1 rounded-full border border-border/40 bg-background/40 px-4 py-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-primary/60"
              />
              <button
                type="submit"
                aria-label="Gửi"
                className="rounded-full bg-gradient-to-br from-primary to-primary-glow p-2.5 text-primary-foreground transition hover:scale-105"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
