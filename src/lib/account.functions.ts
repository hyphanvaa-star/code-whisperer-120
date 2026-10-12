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
    // Middleware validates claims without persisting an Auth session.
    // Profile email stays current even when the JWT predates a rename.
    const { data: profile, error: readError } = await context.supabase
      .from("profiles").select("email").eq("id", context.userId).single();
    if (readError) throw new Error("Không đọc được tài khoản");
    const email = profile?.email || (typeof context.claims.email === "string" ? context.claims.email : "");
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
    const { error: profileError } = await supabaseAdmin.from("profiles").update(prof).eq("id", context.userId);
    if (profileError) throw new Error("Không lưu được tên hiển thị");

    const { logActivity } = await import("./flights.server");
    const parts = [
      patch.email ? `login ${email.split("@")[0]} → ${newEmail.split("@")[0]}` : "",
      patch.password ? "đổi mật khẩu" : "",
      data.displayName ? `tên → ${data.displayName}` : "",
    ].filter(Boolean);
    await logActivity(context.userId, "update_account", parts.join("; "));
    return { ok: true, emailChanged: !!patch.email, username: newEmail.split("@")[0] };
  });

export const getMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("profiles")
      .select("email, display_name, avatar_path").eq("id", context.userId).single();
    if (error) throw new Error("Không đọc được tài khoản");
    let avatarUrl = "";
    if (data.avatar_path?.startsWith(`${context.userId}/`)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const signed = await supabaseAdmin.storage.from("account-avatars").createSignedUrl(data.avatar_path, 3600);
      if (signed.data) {
        const signedUrl = new URL(signed.data.signedUrl);
        const publicBase = import.meta.env.VITE_SUPABASE_URL;
        avatarUrl = publicBase ? `${publicBase.replace(/\/$/, "")}${signedUrl.pathname}${signedUrl.search}` : "";
      }
    }
    return { email: data.email || "", displayName: data.display_name || "", avatarUrl };
  });

export const saveMyAvatar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ image: z.string().max(2_800_000).nullable() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: profile, error } = await context.supabase.from("profiles")
      .select("avatar_path").eq("id", context.userId).single();
    if (error) throw new Error("Không đọc được tài khoản");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let path: string | null = null;
    if (data.image !== null) {
      const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data.image);
      if (!match) throw new Error("Ảnh không hợp lệ");
      const bytes = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
      if (bytes.length > 2 * 1024 * 1024 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("Ảnh JPEG tối đa 2 MB");
      path = `${context.userId}/${crypto.randomUUID()}.jpg`;
      const uploaded = await supabaseAdmin.storage.from("account-avatars").upload(path, bytes, { contentType: "image/jpeg" });
      if (uploaded.error) throw new Error("Không tải được ảnh đại diện");
    }
    const saved = await supabaseAdmin.from("profiles").update({ avatar_path: path }).eq("id", context.userId);
    if (saved.error) {
      if (path) await supabaseAdmin.storage.from("account-avatars").remove([path]);
      throw new Error("Không lưu được ảnh đại diện");
    }
    if (profile.avatar_path?.startsWith(`${context.userId}/`)) await supabaseAdmin.storage.from("account-avatars").remove([profile.avatar_path]);
    return { ok: true };
  });

export const getChatAvatars = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertDispatcher } = await import("./flights.server");
    await assertDispatcher(context.supabase, context.userId);
    const { data, error } = await context.supabase.from("profiles").select("id, avatar_path");
    if (error) throw new Error("Không đọc được ảnh đại diện");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const entries = await Promise.all((data || []).map(async (p) => {
      if (!p.avatar_path?.startsWith(`${p.id}/`)) return [p.id, ""] as const;
      const signed = await supabaseAdmin.storage.from("account-avatars").createSignedUrl(p.avatar_path, 3600);
      if (!signed.data) return [p.id, ""] as const;
      const signedUrl = new URL(signed.data.signedUrl);
      const publicBase = import.meta.env.VITE_SUPABASE_URL;
      return [p.id, publicBase ? `${publicBase.replace(/\/$/, "")}${signedUrl.pathname}${signedUrl.search}` : ""] as const;
    }));
    return Object.fromEntries(entries);
  });
