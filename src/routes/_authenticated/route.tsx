import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Mỗi lần mở web (tab/phiên trình duyệt mới) đều bắt đăng nhập lại:
    // nếu còn phiên lưu sẵn từ lần trước thì xoá rồi đẩy về trang đăng nhập.
    if (!sessionStorage.getItem("fb-login-done")) {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) {
        await supabase.auth.signOut();
        throw redirect({ to: "/auth" });
      }
    }
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: () => <Outlet />,
});
