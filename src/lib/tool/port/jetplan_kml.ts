// Port of jetplan_kml.py — JetPlan route KML fetch + parse (login/session shared
// pattern from ../jetplan.server.ts's cookie-jar `login`/`servlet` helpers, reused here
// so credentials and the jpdcServlet dance aren't duplicated).
const HOME = "https://www.jetplan.com/";
const LOGIN = "https://www.jetplan.com/jeppesen/welcome";
const SERVLET = "https://www.jetplan.com/jeppesen/jpdcServlet";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CS_RE = /\b(VJC\d{2,4}|VJ\d{2,4}|VNA\d{2,4})\b/gi;
const ICAO_RE = /\b([A-Z]{4})\b/g;
const ETD_RE = /(\d{2}[A-Z]{3}\d{2}),\s*(\d{4})Z/g;
const FLT_RE = /query=511&fltnum=(\d+)/g;
const KML_BLOCK_RE = /(<kml[\s\S]+?<\/kml>)/i;
const SKIP_ICAO = new Set(["FILE", "PLAN", "HTML", "HTTP", "HTTPS", "TYPE", "VIEW", "GET ", "NOT ", "HEAD", "BODY", "LINK", "TRUE", "FALSE", "INIT"]);

export class JetPlanError extends Error {}

export interface JetPlanPoint {
  name: string; lon: number; lat: number; alt_m: number;
  fl_ft: number; ete_min: number; airway: string; fir: string;
}
export interface JetPlanPlan { plan: string; callsign: string; dep: string; dest: string; etd: string; via?: string }

export const normCs = (raw: unknown) => {
  let text = String(raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (text.startsWith("VJ") && !text.startsWith("VJC") && /\d/.test(text[2] || "")) text = "VJC" + text.slice(2);
  return text;
};

// ---- cookie-jar fetch (follows redirects manually to keep Set-Cookie), same pattern as jetplan.server.ts ----
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
    throw new JetPlanError("JetPlan: quá nhiều chuyển hướng");
  }
}

let SESSION: { jar: Jar; at: number } | null = null;
const SESSION_S = 18 * 60 * 1000;
let LIST_CACHE: { at: number; rows: JetPlanPlan[] } = { at: 0, rows: [] };
const LIST_S = 10 * 60 * 1000;
const KML_CACHE = new Map<string, { at: number; text: string }>();
const KML_S = 30 * 60 * 1000;

async function login(force = false): Promise<Jar> {
  if (!force && SESSION && Date.now() - SESSION.at < SESSION_S) return SESSION.jar;
  const user = process.env["JETPLAN_USER"] || process.env["JETPLAN_USERNAME"] || "";
  const pass = process.env["JETPLAN_PASS"] || process.env["JETPLAN_PASSWORD"] || "";
  if (!user || !pass) throw new JetPlanError("Thiếu tài khoản JetPlan");
  const jar = new Jar();
  await (await jar.go(HOME)).text();
  const body = new URLSearchParams({ action: "login", login_site: "jpdc", login_page: "", secure_session: "true", loginid: user, password: pass });
  const r = await jar.go(LOGIN, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const t = await r.text();
  if (t.includes("Login Failed") || t.includes("loginForm") || (t.includes("loginid") && t.includes("Secure Login"))) {
    throw new JetPlanError("JetPlan từ chối đăng nhập — kiểm tra account.");
  }
  SESSION = { jar, at: Date.now() };
  return jar;
}

function parseDispatch(html: string): JetPlanPlan[] {
  const out: JetPlanPlan[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(FLT_RE)) {
    const num = m[1]!;
    if (seen.has(num)) continue;
    seen.add(num);
    const window = html.slice(Math.max(0, m.index! - 900), m.index!);
    const callsigns = [...window.matchAll(CS_RE)].map((x) => normCs(x[1]));
    const icaos = [...window.matchAll(ICAO_RE)].map((x) => x[1]!).filter((c) => !SKIP_ICAO.has(c));
    const etds = [...window.matchAll(ETD_RE)];
    let dep = "", dest = "";
    if (icaos.length >= 2) { dep = icaos[icaos.length - 2]!; dest = icaos[icaos.length - 1]!; }
    let callsign = [...callsigns].reverse().find((c) => c.startsWith("VJC")) || "";
    if (!callsign && callsigns.length) callsign = callsigns[callsigns.length - 1]!;
    let etd = "";
    if (etds.length) { const last = etds[etds.length - 1]!; etd = `${last[1]} ${last[2]}Z`; }
    out.push({ plan: num, callsign, dep, dest, etd });
  }
  return out;
}

export async function listPlans(limit = 80, force = false): Promise<JetPlanPlan[]> {
  if (!force && LIST_CACHE.rows.length && Date.now() - LIST_CACHE.at < LIST_S) return [...LIST_CACHE.rows];
  const jar = await login();
  const params = new URLSearchParams({ query: "410", firstPlanNumber: "-1", numberOfPlans: String(Math.max(10, Math.min(limit, 120))), thType: "FP", direction: "init" });
  const r = await jar.go(`${SERVLET}?${params}`);
  if (!r.ok) throw new JetPlanError(`JetPlan HTTP ${r.status}`);
  const rows = parseDispatch(await r.text());
  LIST_CACHE = { at: Date.now(), rows };
  return [...rows];
}

export function matchPlan(flight: { callsign?: string; fltno?: string; dep_icao?: string; dest_icao?: string }, plans: JetPlanPlan[]): JetPlanPlan | null {
  const want = normCs(flight.callsign || flight.fltno || "");
  const dep = String(flight.dep_icao || "").toUpperCase();
  const dest = String(flight.dest_icao || "").toUpperCase();
  const sameCs = plans.filter((p) => p.callsign === want);
  const pool = sameCs.length ? sameCs : plans;
  const scored: [number, JetPlanPlan][] = [];
  for (const row of pool) {
    let score = 0;
    if (row.callsign === want) score += 8;
    if (dep && row.dep === dep) score += 3;
    if (dest && row.dest === dest) score += 3;
    if (score) scored.push([score, row]);
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b[0] - a[0]);
  return { ...scored[0]![1], via: "dispatch" };
}

export async function fetchKml(plan: string, force = false): Promise<string> {
  const num = String(plan || "").replace(/\D/g, "");
  if (!num) throw new JetPlanError("Thiếu số plan JetPlan.");
  const hit = KML_CACHE.get(num);
  if (!force && hit && Date.now() - hit.at < KML_S) return hit.text;
  const jar = await login();
  let text: string | null = null;
  try {
    const r = await jar.go(`${SERVLET}?${new URLSearchParams({ query: "511", fltnum: num })}`);
    if (r.ok) {
      const body = await r.text();
      const block = KML_BLOCK_RE.exec(body);
      if (block) text = block[1]!;
    }
  } catch { /* fall through to static route */ }
  if (text == null) {
    const r = await jar.go(`https://www.jetplan.com/routePlot/RPimages/VJA2_${num}___8.kml`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (r.status === 200 && buf.subarray(0, 400).includes("<kml")) {
      text = buf.toString("utf8");
    } else {
      throw new JetPlanError(`Plan ${num}: JetPlan không trả KML.`);
    }
  }
  KML_CACHE.set(num, { at: Date.now(), text });
  return text;
}

export function parseKml(text: string): { points: JetPlanPoint[]; line: [number, number][] } {
  const points: JetPlanPoint[] = [];
  for (const pm of text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
    const body = pm[1]!;
    if (body.includes("<LineString") || body.includes("GCD from ETP")) continue;
    const nameM = /<name>([^<]+)<\/name>/.exec(body);
    const label = (nameM?.[1] || "").trim();
    if (label.startsWith("ETP") || label.startsWith("Route for")) continue;
    const coord = /<coordinates>\s*([0-9.\-]+)\s*,\s*([0-9.\-]+)(?:\s*,\s*([0-9.\-]+))?/.exec(body);
    if (!coord) continue;
    const fl = /Flight Level at [^=]+=<b>\s*([0-9]+)/.exec(body);
    const ete = /Cumulative Time=<b>\s*([0-9]{2}):([0-9]{2})/.exec(body);
    const fir = /FIR Name=<b>\s*([^<]*)<\/b>/.exec(body);
    const awy = /Airway=<b>\s*([^<]*)<\/b>/.exec(body);
    const minutes = ete ? parseInt(ete[1]!, 10) * 60 + parseInt(ete[2]!, 10) : 0;
    points.push({
      name: label.replace(/\s+/g, " ").trim(),
      lon: parseFloat(coord[1]!), lat: parseFloat(coord[2]!), alt_m: parseFloat(coord[3] || "0"),
      fl_ft: fl ? parseInt(fl[1]!, 10) : 0, ete_min: minutes,
      airway: (awy?.[1] || "").trim(), fir: (fir?.[1] || "").trim().toUpperCase(),
    });
  }
  const line: [number, number][] = [];
  const ls = /<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(text);
  if (ls) {
    for (const pair of ls[1]!.trim().split(/\s+/)) {
      const bits = pair.split(",");
      if (bits.length >= 2) {
        const lon = parseFloat(bits[0]!), lat = parseFloat(bits[1]!);
        if (!Number.isNaN(lon) && !Number.isNaN(lat)) line.push([lon, lat]);
      }
    }
  }
  if (!line.length) for (const p of points) line.push([p.lon, p.lat]);
  return { points, line };
}

export interface TrackFlight {
  plan_no?: string; callsign?: string; fltno?: string; dep_icao?: string; dest_icao?: string;
}

/** Port of jetplan_kml.track_for: KML + NAVLOG points for one FliteBrief flight. */
export async function trackFor(flight: TrackFlight): Promise<{
  plan: string; via: string; callsign: string; dep: string; dest: string;
  points: JetPlanPoint[]; line: [number, number][];
}> {
  const rawNo = String(flight.plan_no || "").trim();
  let planErr: unknown = null;
  if (/^\d+$/.test(rawNo)) {
    try {
      const parsed = parseKml(await fetchKml(rawNo));
      if (parsed.points.length || parsed.line.length) {
        return {
          plan: rawNo, via: "plan_no", callsign: normCs(flight.callsign),
          dep: String(flight.dep_icao || "").toUpperCase(), dest: String(flight.dest_icao || "").toUpperCase(),
          points: parsed.points, line: parsed.line,
        };
      }
    } catch (exc) {
      planErr = exc;
    }
  }
  const plans = await listPlans();
  const plan = matchPlan(flight, plans);
  if (plan && String(plan.plan || "") === rawNo && planErr) throw planErr;
  if (!plan) throw new JetPlanError("Không khớp plan JetPlan (callsign / DEP–ARR) — cần trích xuất nguồn khác.");
  const parsed = parseKml(await fetchKml(plan.plan));
  if (!parsed.points.length && !parsed.line.length) throw new JetPlanError(`KML plan ${plan.plan} không có waypoint.`);
  return {
    plan: plan.plan, via: plan.via || "", callsign: plan.callsign || "",
    dep: plan.dep || "", dest: plan.dest || "", points: parsed.points, line: parsed.line,
  };
}
