import { Mic, MicOff } from "lucide-react";

interface MicButtonProps {
  active: boolean;
  muted: boolean;
  onClick: () => void;
}

export function MicButton({ active, muted, onClick }: MicButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={muted ? "Bật micro" : "Tắt micro"}
      className={`group relative flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 ${
        muted
          ? "bg-muted/60 text-muted-foreground"
          : "bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-[0_10px_40px_-10px_oklch(0.7_0.15_45_/_0.6)]"
      } hover:scale-105`}
    >
      {active && !muted && (
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
      )}
      {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
    </button>
  );
}
