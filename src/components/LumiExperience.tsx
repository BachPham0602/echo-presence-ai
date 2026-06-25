import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Menu, ArrowLeft, Bug } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { LumiCalmFace } from "@/components/lumi/LumiCalmFace";
import { LumiKawaiiFace, type Kawaii } from "@/components/LumiKawaiiFace";
import { MessengerChat } from "@/components/MessengerChat";
import { ChatComposer } from "@/components/ChatComposer";
import { MicButton } from "@/components/MicButton";
import { StatusIndicator } from "@/components/StatusIndicator";

import { ConversationSidebar } from "@/components/ConversationSidebar";
import { useLumiPipeline } from "@/hooks/useLumiPipeline";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useConversations } from "@/store/conversations";
import {
  expressionFromLumi,
  getExpression,
  setExpression,
  subscribeExpression,
  type ExpressionName,
} from "@/components/lumi/ExpressionManager";

export type LumiVariant = "calm" | "playful";

const EXPRESSION_TO_KAWAII: Record<ExpressionName, Kawaii> = {
  neutral: "neutral",
  happy: "happy",
  excited: "excited",
  laughing: "excited",
  playful: "playful",
  speaking: "happy",
  thinking: "worried",
  sad: "sad",
  angry: "angry",
  surprised: "surprised",
  listening: "playful",
};
const expressionToKawaii = (e: ExpressionName): Kawaii => EXPRESSION_TO_KAWAII[e];

interface LumiExperienceProps {
  variant: LumiVariant;
}

const VARIANT_STYLES: Record<
  LumiVariant,
  { name: string; background: string; faceFilter: string }
> = {
  calm: {
    name: "Lumi điềm tĩnh",
    background:
      "radial-gradient(ellipse at 50% 28%, oklch(0.9 0.2 230 / 0.95), transparent 65%), linear-gradient(180deg, oklch(0.78 0.18 235), oklch(0.6 0.18 265))",
    faceFilter: "saturate(1.55) brightness(1.4)",
  },
  playful: {
    name: "Lumi nhí nhảnh",
    background:
      "radial-gradient(ellipse at 50% 28%, oklch(0.93 0.18 60 / 0.95), transparent 65%), linear-gradient(180deg, oklch(0.82 0.2 350), oklch(0.7 0.22 320))",

    faceFilter: "saturate(1.55) brightness(1.4)",
  },
};

export function LumiExperience({ variant }: LumiExperienceProps) {
  const conversations = useConversations();
  const pipeline = useLumiPipeline({
    onMessage: (m) => conversations.appendMessage(m),
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const [override, setOverride] = useState<ExpressionName | null>(null);

  // Sync the global ExpressionManager with the pipeline's auto-detected state.
  useEffect(() => {
    setExpression(expressionFromLumi(pipeline.snapshot.expression));
  }, [pipeline.snapshot.expression]);

  // Subscribe to manual overrides from the dev panel / setExpression() calls.
  const [managed, setManaged] = useState<ExpressionName>(() => getExpression());
  useEffect(() => {
    const unsub = subscribeExpression(setManaged);
    return () => {
      unsub();
    };
  }, []);
  const activeExpression: ExpressionName = override ?? managed;

  const handleFinal = useCallback(
    (text: string) => {
      void pipeline.sendText(text);
    },
    [pipeline],
  );
  const handleInterim = useCallback(
    (text: string) => {
      pipeline.setInterimTranscript(text);
    },
    [pipeline],
  );

  const stt = useSpeechRecognition({
    lang: "vi-VN",
    onFinal: handleFinal,
    onInterim: handleInterim,
  });

  const handleToggleMic = useCallback(async () => {
    if (stt.isListening) stt.stop();
    else await stt.start();
  }, [stt]);

  const statusLabel = recognitionStatusLabel(stt.status);
  const style = VARIANT_STYLES[variant];

  return (
    <main
      className="fixed inset-0 overflow-hidden"
      style={
        {
          width: "100vw",
          height: "100dvh",
          "--lumi-input-bottom": "24px",
          "--lumi-input-h": "clamp(56px, 8vh, 72px)",
          "--lumi-status-bottom": variant === "calm" ? "132px" : "120px",
          "--lumi-chat-bottom": variant === "calm" ? "180px" : "170px",
        } as CSSProperties
      }
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 0, background: style.background }}
        aria-hidden
      />

      <div
        className="pointer-events-none absolute"
        style={{
          zIndex: 1,
          top: variant === "playful" ? "2vh" : "2vh",
          left: "50%",
          transform: "translateX(-50%)",
          width: variant === "playful" ? "min(125vw, 2200px)" : "min(124vw, 2210px)",
          height: variant === "playful" ? "min(98vh, 1170px)" : "min(98vh, 1170px)",
          filter: style.faceFilter,
        }}
      >
        <div className="kawaii-bob h-full w-full">
          {variant === "calm" ? (
            <LumiCalmFace expression={activeExpression} />
          ) : (
            <LumiKawaiiFace
              expression={pipeline.snapshot.expression}
              moodOverride={expressionToKawaii(activeExpression)}
            />
          )}
        </div>
      </div>


      <header className="absolute inset-x-0 top-5 z-30 flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            aria-label="Quay lại trang chọn Lumi"
            className="glass-button flex h-11 w-11 items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Mở danh sách hội thoại"
            className="glass-button h-11 w-11"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setDevOpen((v) => !v)}
          aria-label="Bảng test biểu cảm"
          className="glass-button h-11 w-11 opacity-40 hover:opacity-100"
          title="Dev: Expression panel"
        >
          <Bug className="h-5 w-5" />
        </button>
      </header>

      {devOpen && (
        <div className="absolute right-4 top-20 z-40 grid w-56 grid-cols-2 gap-1.5 rounded-2xl border border-white/15 bg-black/60 p-3 text-xs text-white backdrop-blur-md">
          <div className="col-span-2 mb-1 flex items-center justify-between">
            <span className="font-medium tracking-wide opacity-80">Expressions</span>
            {override && (
              <button
                onClick={() => setOverride(null)}
                className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20"
              >
                Auto
              </button>
            )}
          </div>
          {(
            [
              "neutral",
              "happy",
              "excited",
              "laughing",
              "playful",
              "speaking",
              "thinking",
              "sad",
              "angry",
              "surprised",
            ] as ExpressionName[]
          ).map((name) => (
            <button
              key={name}
              onClick={() => {
                setOverride(name);
                setExpression(name);
              }}
              className={`rounded-md px-2 py-1.5 text-left capitalize transition-colors ${
                activeExpression === name
                  ? "bg-white/25"
                  : "bg-white/5 hover:bg-white/15"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      <ConversationSidebar
        open={sidebarOpen}
        conversations={conversations.conversations}
        activeId={conversations.activeId}
        onClose={() => setSidebarOpen(false)}
        onNew={() => {
          conversations.startNewConversation();
          pipeline.resetMessages();
        }}
        onSelect={(id) => {
          const msgs = conversations.selectConversation(id);
          pipeline.loadMessages(msgs);
        }}
        onDelete={(id) => {
          conversations.deleteConversation(id);
          if (id === conversations.activeId) {
            pipeline.resetMessages();
          }
        }}
        onRename={(id, title) => conversations.renameConversation(id, title)}
      />

      <MessengerChat
        messages={pipeline.messages}
        interimTranscript={pipeline.interimTranscript}
        listening={stt.isListening}
      />

      <div
        className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center gap-1.5 px-4"
        style={{ bottom: "var(--lumi-status-bottom)" }}
      >
        <StatusIndicator
          state={pipeline.snapshot.state}
          labelOverrides={{ idle: `${style.name} đang ở đây với bạn` }}
        />
        {statusLabel && (
          <span className="glass-pill px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-foreground/75">
            {statusLabel}
          </span>
        )}
        {(stt.error || pipeline.snapshot.error) && (
          <p className="glass-pill mt-1 px-4 py-1.5 text-xs text-foreground/85">
            {stt.error ?? pipeline.snapshot.error}
          </p>
        )}
      </div>

      {variant === "calm" ? (
        <ChatComposer
          onSend={(t) => void pipeline.sendText(t)}
          micActive={stt.isListening}
          muted={!stt.isListening}
          onToggleMic={() => void handleToggleMic()}
          listening={stt.isListening}
          interimTranscript={pipeline.interimTranscript}
        />
      ) : (
        <div className="pointer-events-none absolute inset-x-0 z-20 flex justify-center" style={{ bottom: "var(--lumi-input-bottom)" }}>
          <div className="pointer-events-auto">
            <MicButton
              active={stt.isListening}
              muted={!stt.isListening}
              onClick={() => void handleToggleMic()}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function recognitionStatusLabel(
  status: ReturnType<typeof useSpeechRecognition>["status"],
): string | null {
  switch (status) {
    case "checking_permissions":
      return "Đang xin quyền micro…";
    case "starting":
      return "Đang khởi động…";
    case "listening":
      return "Đang nghe…";
    case "speech_detected":
      return "Đã nghe thấy bạn";
    case "processing":
      return "Đang xử lý…";
    case "no_speech":
      return "Chưa nghe rõ";
    case "denied":
      return "Micro bị chặn";
    case "unsupported":
      return "Trình duyệt chưa hỗ trợ";
    case "failed":
      return "Không kết nối được micro";
    default:
      return null;
  }
}
