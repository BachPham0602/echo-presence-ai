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
          "radial-gradient(ellipse at 50% 25%, oklch(0.85 0.18 230 / 0.9), transparent 65%), linear-gradient(180deg, oklch(0.78 0.16 240), oklch(0.62 0.18 285))",
      }}
    >
      <div className="relative z-10 flex h-full w-full flex-col items-center justify-center px-6 py-10">
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-white drop-shadow-lg sm:text-5xl">
            Chào mừng đến với Lumi
          </h1>
          <p className="mt-3 max-w-md text-sm text-white/90 sm:text-base">
            Chọn cách bạn muốn trò chuyện hôm nay.
          </p>
        </div>

        <div className="grid w-full max-w-3xl gap-5 sm:grid-cols-2">
          <Link
            to="/calm"
            className="group glass-pill flex flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center transition hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(160deg, oklch(0.78 0.18 230 / 0.95), oklch(0.6 0.2 260 / 0.95))",
            }}
          >
            <div className="rounded-full bg-white/25 p-4">
              <MessageCircle className="h-8 w-8 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-white">Message Chat</h2>
            <p className="text-xs text-white/90 sm:text-sm">
              Trò chuyện cùng <strong>Lumi điềm tĩnh</strong> — dịu dàng, sâu lắng.
            </p>
          </Link>

          <Link
            to="/playful"
            className="group glass-pill flex flex-col items-center gap-3 rounded-3xl px-6 py-8 text-center transition hover:scale-[1.02]"
            style={{
              background:
                "linear-gradient(160deg, oklch(0.82 0.2 50 / 0.95), oklch(0.72 0.22 350 / 0.95))",
            }}
          >
            <div className="rounded-full bg-white/25 p-4">
              <Radio className="h-8 w-8 text-white" />
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
