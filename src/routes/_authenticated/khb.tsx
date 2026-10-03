import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/khb")({
  head: () => ({
    meta: [
      { title: "Tạo KHB / FPL — Dispatch Board" },
      { name: "description", content: "Tạo KHB và FPL text theo sheet TOOL." },
      { property: "og:title", content: "Tạo KHB / FPL — Dispatch Board" },
      { property: "og:description", content: "Tạo KHB và FPL text theo sheet TOOL." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="Tạo KHB / FPL" items={["Build FPL text, route, alternate", "Extra, taxi, PCR, payload", "Xuất text và file FPL.req"]} />
    </AppShell>
  ),
});
