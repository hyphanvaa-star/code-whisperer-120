import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/notices")({
  head: () => ({
    meta: [
      { title: "Notice — Dispatch Board" },
      { name: "description", content: "Quy tắc notice và đính kèm." },
      { property: "og:title", content: "Notice — Dispatch Board" },
      { property: "og:description", content: "Quy tắc notice và đính kèm." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="Notice" items={["Quản lý notice rules", "Xem trước notice theo chuyến", "Đính kèm notice lên FliteBrief"]} />
    </AppShell>
  ),
});
