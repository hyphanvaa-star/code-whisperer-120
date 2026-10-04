// Shared persistence for ported endpoints — replaces web.py's files under data/.
// JSON state: app_settings (key/value, shared by the team).
// Files (uploaded Excel, PDFs, generated files): private storage bucket "tool-files".
import type { Ctx } from "./types";

export async function getJson<T>(ctx: Ctx, key: string, fallback: T): Promise<T> {
  const { data, error } = await ctx.supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.value as T) ?? fallback;
}

export async function setJson(ctx: Ctx, key: string, value: unknown): Promise<void> {
  const { error } = await ctx.supabase.from("app_settings").upsert({
    key,
    value: value as never,
    updated_by: ctx.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

const BUCKET = "tool-files";

export async function putFile(ctx: Ctx, path: string, body: Blob | ArrayBuffer | Uint8Array, contentType = "application/octet-stream") {
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, body, { upsert: true, contentType });
  if (error) throw new Error(error.message);
}

export async function getFile(ctx: Ctx, path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await ctx.supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return data.arrayBuffer();
}

export async function listFiles(ctx: Ctx, dir: string) {
  const { data, error } = await ctx.supabase.storage.from(BUCKET).list(dir, { limit: 1000, sortBy: { column: "updated_at", order: "desc" } });
  if (error) throw new Error(error.message);
  return (data ?? []).filter((f) => f.id);
}

export async function removeFiles(ctx: Ctx, paths: string[]) {
  if (!paths.length) return;
  const { error } = await ctx.supabase.storage.from(BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
