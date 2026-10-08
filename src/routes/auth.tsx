import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/auth")({
  // Trang đăng nhập giờ nằm ngay tại "/" — giữ "/auth" cho các luồng cũ
  // (đăng xuất, hết phiên) bằng cách chuyển về trang chủ.
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true });
  },
});
