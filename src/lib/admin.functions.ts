import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: { rpc: Function }, userId: string) {
  const { data } = await (supabase.rpc as (f: string, a: object) => Promise<{ data: boolean | null }>)("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!data) throw new Error("Chỉ quản trị viên mới làm được việc này");
}

export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      context.supabase.from("profiles").select("id, email, display_name, original_username, created_at").order("created_at"),
      context.supabase.from("user_roles").select("user_id, role"),
    ]);
    return (profiles ?? []).map((p) => ({
      id: p.id,
      email: p.email ?? "",
      name: p.display_name ?? "",
      original: p.original_username ?? "",
      createdAt: p.created_at,
      roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role),
      isSelf: p.id === context.userId,
    }));
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(["admin", "dispatcher"]), grant: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.userId === context.userId && !data.grant) throw new Error("Không thể tự gỡ quyền của chính mình");
    if (data.grant) {
      const { error } = await context.supabase
        .from("user_roles")
        .upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role", ignoreDuplicates: true });
      if (error) throw new Error("Không cấp được quyền");
    } else {
      const { error } = await context.supabase.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
      if (error) throw new Error("Không gỡ được quyền");
    }
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, data.grant ? "grant_role" : "revoke_role", `${data.role} → ${data.userId}`);
    return { ok: true };
  });

export const listActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data } = await context.supabase
      .from("activity_log")
      .select("id, user_id, action, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    return data ?? [];
  });

// Chỉ tài khoản gốc "hyphan" (admin) được quản lý tài khoản.
const OWNER = "hyphan";
async function assertOwner(supabase: any, userId: string) {
  await assertAdmin(supabase, userId);
  const { data } = await supabase.from("profiles").select("original_username").eq("id", userId).maybeSingle();
  if ((data?.original_username ?? "").toLowerCase() !== OWNER) throw new Error("Chỉ hyphan mới quản lý được tài khoản");
}

export const amIAccountOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try { await assertOwner(context.supabase, context.userId); return { ok: true }; } catch { return { ok: false }; }
  });

const idSchema = z.string().trim().min(2).max(60).regex(/^[a-z0-9._-]+$/i, "ID chỉ gồm chữ, số, . _ -");

export const createAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ username: idSchema, password: z.string().min(8).max(72), displayName: z.string().max(80).optional(), admin: z.boolean().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const u = data.username.toLowerCase();
    const { data: made, error } = await supabaseAdmin.auth.admin.createUser({
      email: `${u}@app.local`, password: data.password, email_confirm: true,
      user_metadata: { full_name: data.displayName?.trim() || u },
    });
    if (error || !made.user) throw new Error(/already/i.test(error?.message ?? "") ? "ID này đã có người dùng" : error?.message || "Không tạo được tài khoản");
    const roles: { user_id: string; role: "admin" | "dispatcher" }[] = [{ user_id: made.user.id, role: "dispatcher" }];
    if (data.admin) roles.push({ user_id: made.user.id, role: "admin" });
    await supabaseAdmin.from("user_roles").upsert(roles, { onConflict: "user_id,role", ignoreDuplicates: true });
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, "create_account", u);
    return { ok: true };
  });

export const resetAccountPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid(), password: z.string().min(8).max(72) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { password: data.password });
    if (error) throw new Error(error.message || "Không đổi được mật khẩu");
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, "reset_password", data.userId);
    return { ok: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (data.userId === context.userId) throw new Error("Không thể tự xóa tài khoản của mình");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message || "Không xóa được tài khoản");
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, "delete_account", data.userId);
    return { ok: true };
  });

export const updateAccountInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), username: idSchema.optional(), displayName: z.string().trim().max(80).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: { email?: string; display_name?: string } = {};
    if (data.username) {
      const email = `${data.username.toLowerCase()}@app.local`;
      const { data: taken } = await supabaseAdmin.from("profiles").select("id").eq("email", email).neq("id", data.userId).maybeSingle();
      if (taken) throw new Error("ID này đã có người dùng");
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { email, email_confirm: true });
      if (error) throw new Error(error.message || "Không đổi được ID");
      patch.email = email;
    }
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (Object.keys(patch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
      if (error) throw new Error("Không lưu được thông tin");
    }
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, "edit_account", data.userId);
    return { ok: true };
  });
