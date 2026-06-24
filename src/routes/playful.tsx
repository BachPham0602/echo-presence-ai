import { createFileRoute } from "@tanstack/react-router";
import { LumiExperience } from "@/components/LumiExperience";

export const Route = createFileRoute("/playful")({
  head: () => ({
    meta: [
      { title: "Lumi nhí nhảnh – Live Chat" },
      {
        name: "description",
        content: "Trò chuyện trực tiếp cùng Lumi nhí nhảnh — vui tươi, năng động.",
      },
      { property: "og:title", content: "Lumi nhí nhảnh – Live Chat" },
      {
        property: "og:description",
        content: "Phong cách nhí nhảnh của Lumi cho những cuộc trò chuyện sôi nổi.",
      },
    ],
  }),
  component: () => <LumiExperience variant="playful" />,
});
