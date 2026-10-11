// Per-user account overrides. A user who saves their own login in the
// "Tài khoản API" dialog gets it used for all their requests; otherwise the
// team defaults from secrets apply. Request-scoped via AsyncLocalStorage.
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

type Scope = { userId: string; vars: Record<string, string>; ip?: string };
const als = new AsyncLocalStorage<Scope>();

export const KINDS: Record<string, { user: string[]; pass: string[]; label: string }> = {
  flitebrief: { user: ["FLITEBRIEF_USER"], pass: ["FLITEBRIEF_PASS"], label: "FliteBrief" },
  omni: { user: ["OMNI_USERNAME", "OMNI_USER"], pass: ["OMNI_PASSWORD", "OMNI_PASS"], label: "InFlight Omni" },
  owa: { user: ["OWA_USERNAME", "OWA_USER"], pass: ["OWA_PASSWORD", "OWA_PASS"], label: "Outlook Web" },
  outlook: { user: ["OUTLOOK_MAIL_USER"], pass: ["OUTLOOK_MAIL_PASS"], label: "Outlook (mail nháp)" },
  aviweb: { user: ["AVIWEB_USERNAME", "AVIWEB_USER"], pass: ["AVIWEB_PASSWORD", "AVIWEB_PASS"], label: "AviWeb" },
};

function key() {
  return createHash("sha256").update("user-cred:" + (process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "")).digest();
}
export function enc(s: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(s, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
function dec(s: string) {
  try {
    const b = Buffer.from(s, "base64");
    const d = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export type Stored = Record<string, { username?: string; password?: string; mailbox?: string; saved_at?: number }>;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadStored(userId: string): Promise<Stored> {
  if (!userId) return {};
  const { data } = await (await admin()).from("user_credentials").select("data").eq("user_id", userId).maybeSingle();
  return ((data?.data as Stored) ?? {}) as Stored;
}

export async function saveStored(userId: string, data: Stored, resetFb = false) {
  const row: Record<string, unknown> = { user_id: userId, data, updated_at: new Date().toISOString() };
  if (resetFb) row["fb_cookies"] = "";
  const { error } = await (await admin()).from("user_credentials").upsert(row as never);
  if (error) throw new Error(error.message);
}

export const OUTLOOK_TTL = 12 * 3600_000;

function toVars(st: Stored): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [kind, v] of Object.entries(st)) {
    const k = KINDS[kind];
    if (!k || !v?.username || !v.password) continue;
    // Outlook (mail nháp): chỉ dùng trong 12 giờ sau khi người dùng tự nhập, không giữ lâu.
    if (kind === "outlook" && !(v.saved_at && Date.now() - v.saved_at < OUTLOOK_TTL)) continue;
    const pw = dec(v.password);
    if (!pw) continue;
    for (const n of k.user) vars[n] = v.username;
    for (const n of k.pass) vars[n] = pw;
    if (kind === "outlook" && v.mailbox) vars["OUTLOOK_MAILBOX"] = v.mailbox;
  }
  return vars;
}

/** Public IP of the browser making this request — pins PC-helper jobs to the helper on the same network. */
export function currentIp(): string {
  return als.getStore()?.ip ?? "";
}

export function requestIp(req: Request): string {
  const h = req.headers;
  return (h.get("cf-connecting-ip") || (h.get("x-forwarded-for") || "").split(",")[0] || h.get("x-real-ip") || "").trim();
}

export async function runWithUserCreds<T>(userId: string, fn: () => Promise<T>, ip = ""): Promise<T> {
  let vars: Record<string, string> = {};
  try {
    vars = toVars(await loadStored(userId));
  } catch {
    /* fall back to defaults */
  }
  return als.run({ userId, vars, ip }, fn);
}

/** Run with explicit overrides (used to test-login before saving). */
export function runWithVars<T>(extra: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const cur = als.getStore();
  return als.run({ userId: cur?.userId ?? "", vars: { ...(cur?.vars ?? {}), ...extra }, ip: cur?.ip ?? "" }, fn);
}

/** Like process.env[name], but the signed-in user's saved account wins. */
export function env(name: string): string | undefined {
  return als.getStore()?.vars[name] ?? process.env[name];
}

/** User id whose own FliteBrief login is active (for a separate session jar), else "". */
export function fbOwner(): string {
  const s = als.getStore();
  return s && s.vars["FLITEBRIEF_USER"] ? s.userId : "";
}
export function isOverride(name: string) {
  return Boolean(als.getStore()?.vars[name]);
}
