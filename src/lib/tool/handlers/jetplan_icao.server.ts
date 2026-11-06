import type { Routes } from "../types";
import { env } from "../creds.server";
import { loadFlights } from "../core/gantts.server";
import { mnlIcao, mnlUtcTime, pickFlightPlan, planBelongsTo } from "../port/formmnl_plan";

// FORM MNL: find the flight's plan in JetPlan Dispatch and return its "View ICAO" page
// (query=776) with the stylesheet inlined and scripts stripped, for client-side rendering.

const BASE = "https://www.jetplan.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

class Jar {
  c = new Map<string, string>();
  async go(url: string, init: RequestInit = {}): Promise<Response> {
    let u = url, opts = init;
    for (let n = 0; n < 10; n++) {
      const r = await fetch(u, { ...opts, redirect: "manual", headers: { "User-Agent": UA, Cookie: [...this.c].map(([k, v]) => `${k}=${v}`).join("; "), ...((opts.headers as Record<string, string>) || {}) } });
      for (const sc of (r.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? []) {
        const kv = sc.split(";")[0]!; const i = kv.indexOf("=");
        if (i > 0) this.c.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
      }
      const loc = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && loc) { u = new URL(loc, u).toString(); opts = {}; continue; }
      return r;
    }
    throw new Error("JetPlan: quá nhiều chuyển hướng");
  }
}

async function login(): Promise<Jar> {
  const user = env("JETPLAN_USER") || env("JETPLAN_USERNAME") || "";
  const pass = env("JETPLAN_PASS") || env("JETPLAN_PASSWORD") || "";
  if (!user || !pass) throw new Error("Thiếu tài khoản JetPlan");
  const jar = new Jar();
  await (await jar.go(BASE + "/")).text();
  const body = new URLSearchParams({ action: "login", login_site: "jpdc", login_page: "", secure_session: "true", loginid: user, password: pass });
  const t = await (await jar.go(BASE + "/jeppesen/welcome", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } })).text();
  if (t.includes("Login Failed") || t.includes("loginForm") || (t.includes("loginid") && t.includes("Secure Login"))) throw new Error("JetPlan từ chối đăng nhập — kiểm tra account.");
  return jar;
}

const txt = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type PlanRow = { plan: number; pod: string; poa: string; etd: string; callsign: string; t: number };

export function parseDispatch(html: string): PlanRow[] {
  const out: PlanRow[] = [];
  for (const m of html.matchAll(/<tr\b[^>]*onMouseOut[\s\S]*?(?=<tr\b[^>]*onMouseOut|<\/table>)/gi)) {
    const row = m[0];
    const plan = Number(/name="button" value="(\d+)"/.exec(row)?.[1] || 0);
    if (!plan || !/query=776/.test(row)) continue;
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => txt(c[1]!));
    const etd = cells[5] || "";
    const e = /(\d{2})([A-Z]{3})(\d{2}),\s*(\d{2})(\d{2})Z/.exec(etd);
    const t = e ? Date.UTC(2000 + +e[3]!, MON.indexOf(e[2]!), +e[1]!, +e[4]!, +e[5]!) : 0;
    out.push({ plan, pod: cells[3] || "", poa: cells[4] || "", etd, callsign: (cells[7] || "").toUpperCase(), t });
  }
  return out;
}

/** Pick the newest plan for the callsign whose ETD is closest to the wanted time (±18h). */
export function pickPlan(rows: PlanRow[], callsign: string, want: number, dep = "", arr = ""): PlanRow | null {
  const cs = callsign.toUpperCase();
  const hits = rows.filter((r) => r.callsign === cs && r.t && (!want || Math.abs(r.t - want) <= 18 * 3600e3)
    && (!dep || !r.pod || r.pod.toUpperCase() === dep) && (!arr || !r.poa || r.poa.toUpperCase() === arr));
  hits.sort((a, b) => (want ? Math.abs(a.t - want) - Math.abs(b.t - want) : 0) || b.plan - a.plan);
  return hits[0] ?? null;
}

export { planBelongsTo };

export const routes: Routes = {
  "GET /api/jetplan/icao": async (ctx) => {
    const digits = (ctx.params.get("flt") || "").replace(/\D/g, "");
    if (!digits) return { error: "Thiếu số hiệu chuyến" };
    const callsign = "VJC" + digits;
    // Crewlist dates are local: derive the real UTC ETD from date + local ETD + UTC ETD.
    const want = mnlUtcTime(ctx.params.get("date") || "", ctx.params.get("etd") || "", ctx.params.get("utc") || "")
      || Number(ctx.params.get("t") || 0);
    // JetPlan Dispatch lists ICAO airports; Crewlist gives IATA (MNL/SGN).
    const dep = mnlIcao(ctx.params.get("dep") || "");
    const arr = mnlIcao(ctx.params.get("arr") || "");
    let direct = Number((ctx.params.get("plan") || "").replace(/\D/g, "") || 0);
    let source = direct ? "manual" : "";
    if (!direct) {
      // Mỗi ngày một CFP: lấy plan_no FliteBrief của đúng chuyến/ngày/chặng.
      try {
        const p = pickFlightPlan(await loadFlights(2), { digits, dep, arr, t: want });
        if (p) { direct = Number(p); source = "flitebrief"; }
      } catch { /* fall back to Dispatch scan */ }
    }
    let jar: Jar;
    try { jar = await login(); } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
    let row: PlanRow | null = null;
    if (direct) {
      // Số CFP trên crewlist chính là số plan JetPlan: tải thẳng, khỏi lật
      // từng trang Dispatch (plan tính sớm trôi khỏi các trang đầu).
      const html = await (await jar.go(`${BASE}/jeppesen/jpdcServlet?query=776&plan=${direct}`)).text();
      if (planBelongsTo(html, callsign)) {
        row = { plan: direct, pod: "", poa: "", etd: "", callsign, t: 0 };
      } else {
        if (source === "manual") return { error: `Plan ${direct} không phải của ${callsign} — kiểm tra lại số CFP` };
        direct = 0; // FliteBrief CFP chưa có trên JetPlan → quét Dispatch
      }
    }
    if (!row) {
      // JetPlan's searchPOD/POA need its full hidden form, so scan the plain
      // Dispatch list and filter by ICAO route + UTC ETD here.
      for (let first = -1, pages = 0; pages < 8 && !row; pages++) {
        const html = await (await jar.go(`${BASE}/jeppesen/jpdcServlet?query=410&firstPlanNumber=${first}&numberOfPlans=50&thType=FP&direction=init`)).text();
        const rows = parseDispatch(html);
        row = pickPlan(rows, callsign, want, dep, arr);
        if (!rows.length) break;
        const min = Math.min(...rows.map((r) => r.plan));
        if (min <= 1) break;
        first = min - 1;
      }
    }
    if (!row) return { error: `Không tìm thấy plan ${callsign}${dep ? ` ${dep}-${arr}` : ""} trong Dispatch JetPlan` };
    let html = await (await jar.go(`${BASE}/jeppesen/jpdcServlet?query=776&plan=${row.plan}`)).text();
    let css = "";
    try { css = await (await jar.go(`${BASE}/atcFiling/stylesheet/icaoDisplay.css`)).text(); } catch { /* render without */ }
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<link[^>]*stylesheet[^>]*>/gi, () => `<style>${css.replace(/<\/?style[^>]*>/gi, "")}</style>`)
      .replace(/<input[^>]*type="(?:submit|reset|button|hidden)"[^>]*>/gi, "");
    html = html.replace(/<div[^>]*id="noprint"[\s\S]*?<\/div>/i, "");
    return { plan: row.plan, callsign, etd: row.etd, pod: row.pod || dep, poa: row.poa || arr, source: source || "dispatch", html };
  },
};
export const jobs = {};
