import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/atc")({
  head: () => ({
    meta: [
      { title: "ATC — Dispatch Board" },
      { name: "description", content: "Kiểm tra ATC FPL và nháp ATC + EZFW." },
      { property: "og:title", content: "ATC — Dispatch Board" },
      { property: "og:description", content: "Kiểm tra ATC FPL và nháp ATC + EZFW." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="ATC" items={["ATC check theo chuyến", "Nháp ATC + EZFW", "In GD (xuất PDF để in)"]} />
    </AppShell>
  ),
});
