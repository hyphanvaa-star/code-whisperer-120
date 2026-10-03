import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/aircraft")({
  head: () => ({
    meta: [
      { title: "Tàu / Defect — Dispatch Board" },
      { name: "description", content: "Giới hạn tàu, defect và MEL." },
      { property: "og:title", content: "Tàu / Defect — Dispatch Board" },
      { property: "og:description", content: "Giới hạn tàu, defect và MEL." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="Tàu / Defect" items={["Tổng hợp defect từ file", "Giới hạn tàu (limits / PCR)", "Đổi tàu, đổi crew"]} />
    </AppShell>
  ),
});
