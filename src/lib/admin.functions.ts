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
