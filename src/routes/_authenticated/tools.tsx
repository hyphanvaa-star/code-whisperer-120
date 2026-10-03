import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/tools")({
  head: () => ({
    meta: [
      { title: "Công cụ hỗ trợ — Dispatch Board" },
      { name: "description", content: "Tải PIB, WX và các công cụ hỗ trợ dispatcher." },
      { property: "og:title", content: "Công cụ hỗ trợ — Dispatch Board" },
      { property: "og:description", content: "Tải PIB, WX và các công cụ hỗ trợ dispatcher." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="Công cụ hỗ trợ" items={["Tải PIB từ hộp thư chung Outlook (dự phòng hộp thứ hai)", "Tải WX từ các đài khí tượng", "Gộp PDF, đính kèm tự động lên FliteBrief"]} />
    </AppShell>
  ),
});
