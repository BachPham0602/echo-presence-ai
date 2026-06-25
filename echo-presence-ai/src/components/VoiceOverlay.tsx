import { Settings, Keyboard } from "lucide-react";
import { MicButton } from "./MicButton";

interface VoiceOverlayProps {
  micActive: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onOpenChat: () => void;
  onOpenSettings: () => void;
}

export function VoiceOverlay({
  micActive,
  muted,
  onToggleMute,
  onOpenChat,
  onOpenSettings,
}: VoiceOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 z-20 flex items-end justify-center gap-6 px-6">
      <button
        type="button"
        onClick={onOpenChat}
        aria-label="Mở ô nhắn tin"
        className="glass-button pointer-events-auto h-12 w-12"
      >
        <Keyboard className="h-5 w-5" />
      </button>
      <div className="pointer-events-auto">
        <MicButton active={micActive} muted={muted} onClick={onToggleMute} />
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Cài đặt"
        className="glass-button pointer-events-auto h-12 w-12"
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  );
}
