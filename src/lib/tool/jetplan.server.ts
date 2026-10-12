// Port of jetplan_ac.py (+ jetplan_kml.login) — real JetPlan login, aircraft DB
// query 650. Cache lives in app_settings "jetplan.ac" (workers share no memory).
import { getJson, setJson } from "./store.server";

type Ctx = Parameters<typeof getJson>[0];
export type AcRow = {
  name: string; type: string; cap: number | null; mtow: number | null; mlwt: number | null;
  fpm: string; fuel_flow: string; fetched?: boolean;
};
type Cache = { at: number; rows: Record<string, AcRow> };

const HOME = "https://www.jetplan.com/";
const LOGIN = "https://www.jetplan.com/jeppesen/welcome";
const SERVLET = "https://www.jetplan.com/jeppesen/jpdcServlet";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TTL_S = 12 * 3600;
const KEY = "jetplan.ac";
export const A33T_LIMIT = 1000, DEFAULT_LIMIT = 500;

const RE_AC_HREF = /query=650(?:&|&amp;)ac=11(?:&|&amp;)acname=([^"&]+)"/gi;
const RE_TD = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const RE_FC = /MAX FUEL CAP\s+(\d{3,6})/i;
const RE_TYPE = /A\/C\s*TYPE\s+([A-Z0-9]{3,5})/i;
const RE_MTOW = /MAX\s+T\/?OFF\s+WT\s+(\d{4,6})/i;
const RE_MLWT = /MAX\s+LNDNG\s+WT\s+(\d{4,6})/i;
const RE_FF = /Fuel\s+Flow\s+([\d.]+)\s*PCT\s*\/\s*HR\s*\/\s*ENG/i;
const RE_FPM = /\b(A3(?:19|20|21|30|32|33)-\d{3}(?:[_/\-][A-Z0-9.]+)+)\b/i;

export const normReg = (raw: unknown) => String(raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const roomLimit = (t: string) => ((t || "").trim().toUpperCase() === "A33T" ? A33T_LIMIT : DEFAULT_LIMIT);
const normFpm = (raw: string) => { const m = RE_FPM.exec(raw || ""); return m ? m[1]!.replace(/_/g, "-") : ""; };
const cellText = (raw: string) => raw.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

export function parseList(html: string) {
  const out: { name: string; type: string; reg: string; fpm: string }[] = [];
  const seen = new Set<string>();
  const hits = [...(html || "").matchAll(RE_AC_HREF)];
  hits.forEach((hit, i) => {
    const name = hit[1]!.trim(), key = normReg(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const endHit = hit.index! + hit[0].length;
    const end = i + 1 < hits.length ? hits[i + 1]!.index! : Math.min(html.length, endHit + 2000);
    const cells = [...html.slice(endHit, end).matchAll(RE_TD)].map((c) => cellText(c[1]!));
    let fpm = "";
    for (const c of cells) { fpm = normFpm(c); if (fpm) break; }
    out.push({ name, type: cells[0] ?? "", reg: key, fpm });
  });
  return out;
}

export function parseRecord(html: string) {
  const plain = (html || "").replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const num = (re: RegExp) => { const m = re.exec(plain); return m ? parseInt(m[1]!, 10) : null; };
  return {
    cap: num(RE_FC), type: (RE_TYPE.exec(plain)?.[1] ?? "").toUpperCase(),
    mtow: num(RE_MTOW), mlwt: num(RE_MLWT), fpm: normFpm(plain), fuel_flow: RE_FF.exec(plain)?.[1] ?? "",
  };
}

// ---- tiny cookie-jar fetch (follows redirects manually to keep Set-Cookie) ----
class Jar {
  c = new Map<string, string>();
  take(r: Response) {
    const list = (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const sc of list) { const [kv] = sc.split(";"); const i = kv!.indexOf("="); if (i > 0) this.c.set(kv!.slice(0, i).trim(), kv!.slice(i + 1).trim()); }
  }
  header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  async go(url: string, init: RequestInit = {}): Promise<Response> {
    let u = url, opts = init;
    for (let n = 0; n < 10; n++) {
      const r = await fetch(u, { ...opts, redirect: "manual", headers: { "User-Agent": UA, Cookie: this.header(), ...(opts.headers as Record<string, string> || {}) } });
      this.take(r);
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).toString(); opts = { method: "GET" }; continue; }
      return r;
    }
    throw new Error("JetPlan: quá nhiều chuyển hướng");
  }
}

async function login(): Promise<Jar> {
  const user = process.env["JETPLAN_USER"] || process.env["JETPLAN_USERNAME"] || "";
  const pass = process.env["JETPLAN_PASS"] || process.env["JETPLAN_PASSWORD"] || "";
  if (!user || !pass) throw new Error("Thiếu tài khoản JetPlan");
  const jar = new Jar();
  await (await jar.go(HOME)).text();
  const body = new URLSearchParams({ action: "login", login_site: "jpdc", login_page: "", secure_session: "true", loginid: user, password: pass });
  const r = await jar.go(LOGIN, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const t = await r.text();
  if (t.includes("Login Failed") || t.includes("loginForm") || (t.includes("loginid") && t.includes("Secure Login"))) throw new Error("JetPlan từ chối đăng nhập — kiểm tra account.");
  return jar;
}

const servlet = async (jar: Jar, q: Record<string, string>) => {
  const r = await jar.go(`${SERVLET}?${new URLSearchParams(q)}`);
  if (!r.ok) throw new Error(`JetPlan HTTP ${r.status}`);
  return r.text();
};

let MEM: Cache | null = null;
async function load(ctx: Ctx): Promise<Cache> {
  if (MEM) return MEM;
  return (MEM = await getJson<Cache>(ctx, KEY, { at: 0, rows: {} }).catch(() => ({ at: 0, rows: {} })));
}
const stale = (r?: AcRow) => !r || r.cap == null || r.mtow == null;

/** jetplan_ac.ensure_regs + warmup: fetch whole fleet list, then missing records. */
export async function ensureRegs(ctx: Ctx, regs: string[]): Promise<void> {
  const cache = await load(ctx);
  const want = [...new Set(regs.map(normReg).filter(Boolean))];
  const old = Date.now() / 1000 - cache.at > TTL_S;
  const todo = want.filter((r) => stale(cache.rows[r]));
  const needList = old || want.some((r) => !cache.rows[r]?.fpm);
  if (!todo.length && !needList) return;
  let jar: Jar;
  try { jar = await login(); } catch (e) { console.warn("JetPlan login:", e instanceof Error ? e.message : e); return; }
  if (needList) {
    try {
      for (const row of parseList(await servlet(jar, { query: "650" }))) {
        const cur = cache.rows[row.reg];
        cache.rows[row.reg] = { cap: cur?.cap ?? null, mtow: cur?.mtow ?? null, mlwt: cur?.mlwt ?? null, fuel_flow: cur?.fuel_flow ?? "", name: row.name, type: cur?.type || row.type, fpm: row.fpm || cur?.fpm || "" };
      }
    } catch (e) { console.warn("JetPlan list:", e); }
  }
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (reg) => {
      try {
        const rec = parseRecord(await servlet(jar, { query: "650", ac: "11", acname: cache.rows[reg]?.name || reg }));
        if (rec.cap == null) return;
        const cur = cache.rows[reg];
        cache.rows[reg] = { name: cur?.name || reg, type: rec.type || cur?.type || "", cap: rec.cap, mtow: rec.mtow, mlwt: rec.mlwt, fpm: rec.fpm || cur?.fpm || "", fuel_flow: rec.fuel_flow, fetched: true };
      } catch { /* one aircraft failing doesn't stop the rest */ }
    }));
  }
  cache.at = Date.now() / 1000;
  await setJson(ctx, KEY, cache).catch(() => {});
}

/** jetplan_ac.lookup */
export async function lookup(ctx: Ctx, reg: string) {
  const r = (await load(ctx)).rows[normReg(reg)];
  if (!r || r.cap == null) return null;
  return { cap: r.cap, type: r.type, limit: roomLimit(r.type), name: r.name || normReg(reg), mtow: r.mtow, mlwt: r.mlwt, fpm: r.fpm || "", fuel_flow: r.fuel_flow || "" };
}

/** jetplan_ac.specs */
export async function specs(ctx: Ctx, reg: string) {
  const r = (await load(ctx)).rows[normReg(reg)];
  return { fpm: r?.fpm || "", mtow: r?.mtow ?? null, mlwt: r?.mlwt ?? null, fuel_flow: r?.fuel_flow || "", type: r?.type || "" };
}
