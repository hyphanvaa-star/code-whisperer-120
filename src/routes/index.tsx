import { createFileRoute } from "@tanstack/react-router";
import { AuthScreen } from "@/components/AuthScreen";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Đăng nhập — Dispatch Board" },
      { name: "description", content: "Đăng nhập hệ thống Dispatch Board bằng ID và mật khẩu được cấp." },
      { property: "og:title", content: "Đăng nhập — Dispatch Board" },
      { property: "og:description", content: "Đăng nhập hệ thống Dispatch Board bằng ID và mật khẩu được cấp." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthScreen,
});
