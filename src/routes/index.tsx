import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { Menu } from "lucide-react";

import { LumiFace } from "@/components/LumiFace";
import { MessengerChat } from "@/components/MessengerChat";
import { ChatComposer } from "@/components/ChatComposer";
import { StatusIndicator } from "@/components/StatusIndicator";
import { EmotionIndicator } from "@/components/EmotionIndicator";
import { ConversationSidebar } from "@/components/ConversationSidebar";
import { useLumiPipeline } from "@/hooks/useLumiPipeline";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useConversations } from "@/store/conversations";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumi – Ánh sáng đồng hành" },
      {
        name: "description",
        content:
          "Lumi là người bạn đồng hành bằng giọng nói, luôn ở đây với bạn — ấm áp, dịu dàng và lắng nghe.",
      },
      { property: "og:title", content: "Lumi – Ánh sáng đồng hành" },
      {
        property: "og:description",
        content: "Một người bạn AI đồng hành bằng giọng nói, dành cho những ai sống một mình.",
      },
    ],
  }),
  component: LumiHome,
});

function LumiHome() {
  const conversations = useConversations();
  const pipeline = useLumiPipeline({
    onMessage: (m) => conversations.appendMessage(m),
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* Deep navy backdrop */}
      <div
        className="pointer-events-none absolute inset-0 -z-20"
        style={{
          background:
            "radial-gradient(ellipse at 50% 30%, oklch(0.28 0.12 255 / 0.9), transparent 65%), linear-gradient(180deg, oklch(0.1 0.05 260), oklch(0.06 0.03 265))",
        }}
        aria-hidden
      />

      {/* Lumi's face — full-screen living wallpaper */}
      <LumiFace expression={pipeline.snapshot.expression} />

      {/* Top bar — hamburger only by default */}
      <header className="absolute inset-x-0 top-5 z-30 flex items-center justify-between px-5">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Mở danh sách hội thoại"
          className="glass-button h-11 w-11"
        >
          <Menu className="h-5 w-5" />
        </button>
        <EmotionIndicator emotion={pipeline.snapshot.lastUserEmotion} />
      </header>

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
        onDelete={(id) => conversations.deleteConversation(id)}
      />

      {/* Messenger-style conversation, overlayed on top of the face */}
      <MessengerChat
        messages={pipeline.messages}
        interimTranscript={pipeline.interimTranscript}
        listening={isListening}
      />

      {/* Floating status above the composer */}
      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex flex-col items-center gap-1.5">
        <StatusIndicator state={pipeline.snapshot.state} />
        {statusLabel && (
          <span className="glass-pill px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-foreground/75">
            {statusLabel}
          </span>
        )}
      </div>

      {/* Error / hint pill */}
      {(stt.error || pipeline.snapshot.error) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-20 flex justify-center px-6">
          <p className="glass-pill px-4 py-1.5 text-xs text-foreground/85">
            {stt.error ?? pipeline.snapshot.error}
          </p>
        </div>
      )}

      {/* Bottom composer — always visible */}
      <ChatComposer
        onSend={(t) => void pipeline.sendText(t)}
        micActive={stt.isListening}
        muted={!stt.isListening}
        onToggleMic={() => void handleToggleMic()}
        listening={stt.isListening}
      />
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
