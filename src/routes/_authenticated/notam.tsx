import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/notam")({
  head: () => ({
    meta: [
      { title: "NOTAM — Dispatch Board" },
      { name: "description", content: "Check và theo dõi NOTAM theo chuyến bay." },
      { property: "og:title", content: "NOTAM — Dispatch Board" },
      { property: "og:description", content: "Check và theo dõi NOTAM theo chuyến bay." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="NOTAM" items={["Check NOTAM theo sân bay / FIR", "Track NOTAM theo chuyến, có tiến độ", "Bản đồ vùng NOTAM và ghim"]} />
    </AppShell>
  ),
});
