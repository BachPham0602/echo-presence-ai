import { createFileRoute, Link } from "@tanstack/react-router";
import { MessageCircle, Radio } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lumi – Chọn người bạn đồng hành" },
      {
        name: "description",
        content:
          "Chọn cách trò chuyện với Lumi: Message Chat với Lumi điềm tĩnh, hoặc Live Chat với Lumi nhí nhảnh.",
      },
      { property: "og:title", content: "Lumi – Chọn người bạn đồng hành" },
      {
        property: "og:description",
        content: "Hai phong cách Lumi, một trái tim ấm áp lắng nghe bạn.",
      },
    ],
  }),
  component: LumiLanding,
});

function LumiLanding() {
  return (
    <main
      className="fixed inset-0 overflow-hidden"
      style={{
        background:
          "radial-gradient(ellipse at 50% 28%, oklch(0.6 0.22 255 / 0.8), transparent 65%), linear-gradient(180deg, oklch(0.24 0.15 260), oklch(0.12 0.08 265))",
      }}
    >
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-6 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Chào mừng đến với Lumi
          </h1>
          <p className="mt-3 max-w-md text-sm text-foreground/70 sm:text-base">
            Chọn cách bạn muốn trò chuyện hôm nay.
          </p>
        </div>

        <div className="grid w-full max-w-3xl gap-5 sm:grid-cols-2">
          <Link
            to="/calm"
            className="group glass-pill flex flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center transition hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(160deg, oklch(0.55 0.22 250 / 0.85), oklch(0.32 0.16 265 / 0.85))",
            }}
          >
            <div className="rounded-full bg-white/10 p-4">
              <MessageCircle className="h-8 w-8 text-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Message Chat</h2>
            <p className="text-xs text-foreground/70 sm:text-sm">
              Trò chuyện cùng <strong>Lumi điềm tĩnh</strong> — dịu dàng, sâu lắng.
            </p>
          </Link>

          <Link
            to="/playful"
            className="group glass-pill flex flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center transition hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(160deg, oklch(0.68 0.24 25 / 0.85), oklch(0.42 0.2 340 / 0.85))",
            }}
          >
            <div className="rounded-full bg-white/10 p-4">
              <Radio className="h-8 w-8 text-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Live Chat</h2>
            <p className="text-xs text-foreground/70 sm:text-sm">
              Trò chuyện cùng <strong>Lumi nhí nhảnh</strong> — vui tươi, năng động.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
