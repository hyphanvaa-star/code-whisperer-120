import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PortingPanel } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/compare")({
  head: () => ({
    meta: [
      { title: "Dữ liệu so sánh — Dispatch Board" },
      { name: "description", content: "Đối chiếu file Excel với dữ liệu FliteBrief." },
      { property: "og:title", content: "Dữ liệu so sánh — Dispatch Board" },
      { property: "og:description", content: "Đối chiếu file Excel với dữ liệu FliteBrief." },
    ],
  }),
  component: () => (
    <AppShell>
      <PortingPanel title="Dữ liệu so sánh" items={["Nạp file Excel, chọn sheet và dòng tiêu đề", "Gắn cột với trường FliteBrief", "Tô các ô lệch, xoá dòng, chọn chuyến"]} />
    </AppShell>
  ),
});
