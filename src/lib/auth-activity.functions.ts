import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Ghi lại lúc người dùng đăng nhập / đăng xuất vào nhật ký hoạt động.
export const logAuthEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event: "sign_in" | "sign_out" }) => input)
  .handler(async ({ data, context }) => {
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, data.event);
  });
