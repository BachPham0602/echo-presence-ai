import { useState, type FormEvent } from "react";
import { Mic, MicOff, Send } from "lucide-react";

interface ChatComposerProps {
  onSend: (text: string) => void;
  onTyping?: () => void;
  micActive: boolean;
  muted: boolean;
  onToggleMic: () => void;
  listening?: boolean;
  interimTranscript?: string;
}

/**
 * Messenger-style bottom composer fixed to the viewport bottom.
 * Always visible — text input on the left, mic button on the right.
 */
export function ChatComposer({
  onSend,
  onTyping,
  micActive,
  muted,
  onToggleMic,
  listening,
  interimTranscript,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const interim = (interimTranscript ?? "").trim();
  const showingInterim = listening && interim.length > 0 && value.trim().length === 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim();
    if (!t) return;
    onSend(t);
    setValue("");
  };

  return (
    <form
      onSubmit={submit}
      className="pointer-events-auto absolute z-20 flex items-center gap-2 rounded-full border border-white/15 bg-black/35 px-2 shadow-[0_18px_48px_-20px_rgba(0,20,60,0.7)] backdrop-blur-2xl"
      style={{
        bottom: "var(--lumi-input-bottom, 16px)",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(92vw, 760px)",
        height: "var(--lumi-input-h, 64px)",
      }}
    >
        <input
          value={showingInterim ? interim : value}
          onChange={(e) => {
            setValue(e.target.value);
            onTyping?.();
          }}
          readOnly={showingInterim}
          placeholder={listening ? "Đang nghe…" : "Nhắn cho Lumi..."}
          aria-label="Nhắn cho Lumi"
          className={`flex-1 bg-transparent px-4 py-2 text-sm focus:outline-none ${
            showingInterim
              ? "italic text-foreground/75 placeholder:text-foreground/45"
              : "text-foreground placeholder:text-foreground/45"
          }`}
        />

        {value.trim() ? (
          <button
            type="submit"
            aria-label="Gửi"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:scale-105"
          >
            <Send className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleMic}
            aria-label={muted ? "Bật micro" : "Tắt micro"}
            aria-pressed={micActive && !muted}
            className={`relative flex h-10 w-10 items-center justify-center rounded-full transition ${
              muted
                ? "bg-white/10 text-foreground/70 hover:bg-white/15"
                : "bg-primary text-primary-foreground hover:scale-105"
            }`}
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            {listening && !muted && (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" />
                <span className="absolute -inset-1 animate-pulse rounded-full bg-primary/20" />
              </>
            )}
          </button>
        )}
    </form>
  );
}