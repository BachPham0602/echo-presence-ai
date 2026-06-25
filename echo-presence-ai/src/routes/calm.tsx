import { createFileRoute } from "@tanstack/react-router";
import { LumiExperience } from "@/components/LumiExperience";

export const Route = createFileRoute("/calm")({
  head: () => ({
    meta: [
      { title: "Lumi điềm tĩnh – Message Chat" },
      {
        name: "description",
        content: "Trò chuyện cùng Lumi điềm tĩnh — dịu dàng, sâu lắng, luôn lắng nghe bạn.",
      },
      { property: "og:title", content: "Lumi điềm tĩnh – Message Chat" },
      {
        property: "og:description",
        content: "Phong cách điềm tĩnh của Lumi dành cho những cuộc trò chuyện sâu lắng.",
      },
    ],
  }),
  component: () => <LumiExperience variant="calm" />,
});
