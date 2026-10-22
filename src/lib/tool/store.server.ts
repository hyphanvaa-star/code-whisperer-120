// Shared persistence for ported endpoints — replaces web.py's files under data/.
// JSON state: app_settings (key/value, shared by the team).
// Files (uploaded Excel, PDFs, generated files): private storage bucket "tool-files".
import type { Ctx } from "./types";

/** Team config tables: admin saves the team copy; other users save a private copy at `<key>@u:<uid>`. */
export const LAYERED_KEYS = new Set([
  "notice_rules", "fpl.cost_index", "fpl.taxi_fuel", "fpl.route_suffix",
  "fpl.alt_route", "fpl.era", "fpl.pcr_limits",
]);
const userKey = (ctx: Ctx, key: string) => `${key}@u:${ctx.userId}`;
const adminCache = new WeakMap<object, Promise<boolean>>();
export function isAdmin(ctx: Ctx): Promise<boolean> {
  let p = adminCache.get(ctx);
  if (!p) {
    p = Promise.resolve(ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }))
      .then(({ data }) => data === true, () => false);
    adminCache.set(ctx, p);
  }
  return p;
}

async function rawGet(ctx: Ctx, key: string): Promise<{ found: boolean; value: unknown }> {
  const { data, error } = await ctx.supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return { found: !!data, value: data?.value };
}

export async function getJson<T>(ctx: Ctx, key: string, fallback: T): Promise<T> {
  if (LAYERED_KEYS.has(key) && ctx.userId && !(await isAdmin(ctx))) {
    const own = await rawGet(ctx, userKey(ctx, key));
    if (own.found && own.value != null && !(own.value as { __team?: boolean }).__team) return own.value as T;
  }
  const r = await rawGet(ctx, key);
  return (r.value as T) ?? fallback;
}

export async function setJson(ctx: Ctx, key: string, value: unknown): Promise<void> {
  const target = LAYERED_KEYS.has(key) && !(await isAdmin(ctx)) ? userKey(ctx, key) : key;
  const track = !/^(ofp\.|excel\.current|aip_sup|owa_|fb_|omni_|chg:|.*token|.*session|.*cookie)/i.test(target);
  const prev = track ? (await rawGet(ctx, target).catch(() => ({ value: null }))).value : null;
  const { error } = await ctx.supabase.from("app_settings").upsert({
    key: target,
    value: value as never,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  if (track) await logChange(ctx, target, prev, value).catch(() => {});
}

/** Keep a short history of what each save added/removed so the admin can see real edits. */
async function logChange(ctx: Ctx, target: string, prev: unknown, next: unknown) {
  const { diffLines } = await import("./port/change_lines");
  const d = diffLines(prev, next);
  if (!d.added.length && !d.removed.length) return;
  const key = `chg:${target}`;
  const old = (await rawGet(ctx, key)).value as { list?: unknown[] } | null;
  const entry = { at: new Date().toISOString(), by: ctx.userId, added: d.added.slice(0, 100), removed: d.removed.slice(0, 100) };
  await ctx.supabase.from("app_settings").upsert({
    key, value: { list: [entry, ...(old?.list ?? [])].slice(0, 30) } as never,
    updated_by: ctx.userId, updated_at: entry.at,
  });
}

/** Drop the caller's private copy so they follow the admin's team version again. */
export async function resetToTeam(ctx: Ctx, key: string): Promise<void> {
  if (!LAYERED_KEYS.has(key)) return;
  const { error } = await ctx.supabase.from("app_settings").update({ value: { __team: true } as never }).eq("key", userKey(ctx, key));
  if (error) throw new Error(error.message);
}

const BUCKET = "tool-files";

// Storage keys reject non-ASCII (e.g. "ĐÃ FIX"): encode each segment reversibly, "!XX" = byte XX.
export function encodeKeySegment(seg: string): string {
  return encodeURIComponent(seg).replace(/!/g, "%21").replace(/%20/g, " ").replace(/%/g, "!");
}
export function decodeKeySegment(seg: string): string {
  if (!seg.includes("!")) return seg;
  try { return decodeURIComponent(seg.replace(/!/g, "%")); } catch { return seg; }
}
const enc = (path: string) => path.split("/").map(encodeKeySegment).join("/");

export async function putFile(ctx: Ctx, path: string, body: Blob | ArrayBuffer | Uint8Array, contentType = "application/octet-stream") {
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(enc(path), body, { upsert: true, contentType });
  if (error) throw new Error(error.message);
}

export async function getFile(ctx: Ctx, path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await ctx.supabase.storage.from(BUCKET).download(enc(path));
  if (error || !data) return null;
  return data.arrayBuffer();
}

export async function listFiles(ctx: Ctx, dir: string) {
  const { data, error } = await ctx.supabase.storage.from(BUCKET).list(enc(dir), { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.id).map((f) => ({ ...f, name: decodeKeySegment(f.name) }));
}

export async function removeFiles(ctx: Ctx, paths: string[]) {
  if (!paths.length) return;
  const { error } = await ctx.supabase.storage.from(BUCKET).remove(paths.map(enc));
  if (error) throw new Error(error.message);
}
