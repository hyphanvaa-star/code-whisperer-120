import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  displayName: z.string().trim().min(1).max(60).optional(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "Tên đăng nhập 3–32 ký tự: chữ, số, . _ -")
    .optional(),
  newPassword: z.string().min(6, "Mật khẩu mới tối thiểu 6 ký tự").max(200).optional(),
});

export const updateMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => schema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: me } = await context.supabase.auth.getUser();
    const email = me.user?.email;
    if (!email) throw new Error("Không đọc được tài khoản");

    // Xác minh mật khẩu hiện tại bằng client riêng, không lưu phiên.
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const check = createClient(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { error: pwErr } = await check.auth.signInWithPassword({ email, password: data.currentPassword });
    if (pwErr) throw new Error("Mật khẩu hiện tại không đúng");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { email?: string; password?: string; email_confirm?: boolean } = {};
    let newEmail = email;
    if (data.username) {
      newEmail = `${data.username}@app.local`;
      if (newEmail !== email) {
        const { data: taken } = await supabaseAdmin.from("profiles").select("id").eq("email", newEmail).maybeSingle();
        if (taken) throw new Error("Tên đăng nhập đã có người dùng");
        patch.email = newEmail;
        patch.email_confirm = true;
      }
    }
    if (data.newPassword) patch.password = data.newPassword;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, patch);
      if (error) throw new Error("Không cập nhật được tài khoản");
    }
    const prof: { email: string; display_name?: string } = { email: newEmail };
    if (data.displayName) prof.display_name = data.displayName;
    await supabaseAdmin.from("profiles").update(prof).eq("id", context.userId);

    const { logActivity } = await import("./flights.server");
    const parts = [
      patch.email ? `login ${email.split("@")[0]} → ${newEmail.split("@")[0]}` : "",
      patch.password ? "đổi mật khẩu" : "",
      data.displayName ? `tên → ${data.displayName}` : "",
    ].filter(Boolean);
    await logActivity(context.userId, "update_account", parts.join("; "));
    return { ok: true, emailChanged: !!patch.email, username: newEmail.split("@")[0] };
  });
