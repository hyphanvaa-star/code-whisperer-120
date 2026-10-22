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
    const { error: profErr } = await supabaseAdmin.from("profiles").upsert(
      { id: made.user.id, email: `${u}@app.local`, display_name: data.displayName?.trim() || u, original_username: u },
      { onConflict: "id" },
    );
    if (profErr) throw new Error("Đã tạo tài khoản nhưng không lưu được hồ sơ");
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

const DATA_LABEL: Record<string, string> = {
  notice_rules: "Notice Rules", "fpl.cost_index": "KHB · Cost Index", "fpl.taxi_fuel": "KHB · Taxi fuel",
  "fpl.route_suffix": "KHB · Route suffix", "fpl.alt_route": "KHB · Alternate route", "fpl.era": "KHB · ERA route",
  "fpl.pcr_limits": "KHB · PCR",
};

// Ảnh đại diện + mọi dữ liệu do người này chỉnh (bản riêng và bản chung họ sửa gần nhất).
export const accountDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ userIds: z.array(z.string().uuid()).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profs }, { data: rows }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, avatar_path").in("id", data.userIds),
      supabaseAdmin.from("app_settings").select("key, updated_by, updated_at, value").in("updated_by", data.userIds).order("updated_at", { ascending: false }).limit(1000),
    ]);
    type Chg = { at: string; by: string; added: string[]; removed: string[] };
    const out: Record<string, { avatarUrl: string; edits: { key: string; label: string; personal: boolean; updatedAt: string; size: number; lines: string[]; changes: Chg[] }[] }> = {};
    for (const id of data.userIds) out[id] = { avatarUrl: "", edits: [] };
    await Promise.all((profs ?? []).map(async (p) => {
      if (!p.avatar_path) return;
      const s = await supabaseAdmin.storage.from("account-avatars").createSignedUrl(p.avatar_path, 3600);
      if (s.data?.signedUrl) out[p.id].avatarUrl = s.data.signedUrl;
    }));
    const { data: chgRows } = await supabaseAdmin.from("app_settings").select("key, value").like("key", "chg:%").limit(500);
    const chg = new Map<string, Chg[]>((chgRows ?? []).map((c) => [c.key.slice(4), ((c.value as { list?: Chg[] })?.list ?? [])]));
    for (const r of rows ?? []) {
      if (!r.updated_by || !out[r.updated_by]) continue;
      const personal = r.key.includes("@u:");
      const base = r.key.split("@u:")[0];
      // Automatic per-flight/working caches and login tokens are not user edits — hide them.
      if (/^(chg:|ofp\.|excel\.current|aip_sup|owa_|fb_|omni_|.*token|.*session|.*cookie)/i.test(base)) continue;
      const v = r.value as unknown;
      const size = Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 1;
      const changes = (chg.get(r.key) ?? []).filter((c) => c.by === r.updated_by);
      out[r.updated_by].edits.push({ key: r.key, label: DATA_LABEL[base] ?? base, personal, updatedAt: r.updated_at, size, lines: [], changes });
    }
    return out;
  });

export const resetPersonalData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ key: z.string().regex(/@u:[0-9a-f-]{36}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("app_settings").delete().eq("key", data.key);
    if (error) throw new Error("Không xóa được bản riêng");
    const { logActivity } = await import("./flights.server");
    await logActivity(context.userId, "reset_personal", data.key);
    return { ok: true };
  });

const SECRET_RE = /pass|token|secret|cookie|session|pwd/i;
const GROUP_VI: Record<string, string> = {
  curfew: "Giờ cấm bay (curfew)", special: "Giới hạn đặc biệt", aircraft: "Giới hạn theo tàu",
  airports: "Giới hạn sân bay", acgroups: "Nhóm tàu", defects: "Lỗi kỹ thuật",
};
const FIELD_VI: Record<string, string> = {
  code: "Sân", reg: "Tàu", defect: "Lỗi", limit: "Giới hạn", start: "Từ", end: "Đến", type: "Loại",
  note: "Ghi chú", rule: "Quy tắc", acs: "Tàu", apts: "Sân", text: "Nội dung", id: "Mã",
};
function cell(x: unknown): string {
  if (x == null || x === "") return "";
  if (typeof x !== "object") return String(x);
  if (Array.isArray(x)) return x.map(cell).filter(Boolean).join(", ");
  const o = x as Record<string, unknown>;
  if (o.start != null && o.end != null && o.code) return `${o.code}: cấm ${o.start} – ${o.end}`;
  return Object.entries(o)
    .filter(([k, val]) => !SECRET_RE.test(k) && val !== "" && val != null && !/^(_|at$|ts$|updated)/.test(k))
    .map(([k, val]) => `${FIELD_VI[k] ?? k}: ${typeof val === "object" ? cell(val) : String(val)}`)
    .join(" | ");
}
/** Readable summary: one line per saved item, grouped by section, so the owner sees exactly what was set. */
function previewLines(v: unknown): string[] {
  const list: string[] = [];
  const push = (s: string) => { if (s) list.push(s.length > 220 ? s.slice(0, 220) + "…" : s); };
  if (Array.isArray(v)) v.forEach((it, i) => push(`${i + 1}. ${cell(it)}`));
  else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SECRET_RE.test(k)) continue;
      if (Array.isArray(val)) {
        push(`■ ${GROUP_VI[k] ?? k} (${val.length} mục)`);
        val.forEach((it) => push(`   • ${cell(it)}`));
      } else push(`${GROUP_VI[k] ?? FIELD_VI[k] ?? k}: ${cell(val)}`);
    }
  } else push(cell(v));
  return list.slice(0, 120);
}
