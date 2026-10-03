import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { VersionCompare } from "@/components/compare-views";

export const Route = createFileRoute("/_authenticated/ver")({
  head: () => ({
    meta: [
      { title: "Dữ liệu thay đổi theo ver — Dispatch Board" },
      { name: "description", content: "So bản kế hoạch đang dùng với bản mới: đổi tàu, đổi crew, delay." },
      { property: "og:title", content: "Dữ liệu thay đổi theo ver — Dispatch Board" },
      { property: "og:description", content: "So bản kế hoạch đang dùng với bản mới: đổi tàu, đổi crew, delay." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <AppShell>
      <VersionCompare />
    </AppShell>
  ),
});
