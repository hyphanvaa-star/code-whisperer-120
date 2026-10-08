// Port of aip_sup.py's network + cache layer. Pure parsers live in
// port/aip_sup.ts; this file does fetch(), Japan SWIM login, PDF text
// extraction (unpdf) and store-backed caching (app_settings key per SUP,
// replacing data/aip_sup/*.json + data/aip_dah/rings.json).
import type { Ctx } from "./types";
import { getJson, setJson } from "./store.server";
import * as p from "./port/aip_sup";
import type { RingTable, Pt } from "./port/aip_sup";

const UA = "DispatchBoard-AIP/1.0";
const OK_TTL_S = 30 * 24 * 3600;
const FAIL_TTL_S = 6 * 3600;
const CACHE_VER = 3;
const DAH_VER = 2;
const FETCH_TO_MS = 15_000;
const AUTH_URL = "https://top.swim.mlit.go.jp/swim/webapi/login";
const AIP_BASE = "https://web.swim.mlit.go.jp";
const TW_EAIP = "https://ais.caa.gov.tw/eaip/";
const DAH_PDF = [
  "https://www.airservicesaustralia.com/aip/current/dah/DAH_09JUL2026.pdf",
  "https://www.airservicesaustralia.com/aip/current/dah/DAH_26NOV2026.pdf",
];

type CacheRec = { ts: number; v: number; error?: string; hours?: string; rings?: Record<string, { name: string; ring: [number, number][] }> };
type DahRec = { ts: number; v: number; error?: string; rings?: Record<string, [number, number][]> };

// Per-isolate state (mirrors module-level globals in aip_sup.py).
const _mem = new Map<string, RingTable>();
const _hoursMem = new Map<string, string>();
let _dahMem: Record<string, Pt[]> | null = null;
let _swim: { msmsi: string; msmai: string; at: number } | null = null;
let _slowHits = 0;
let _slowUntil = 0;
const SLOW_NEED = 2;
const SLOW_PAUSE_MS = 90_000;

function netPaused(): boolean {
  return Date.now() < _slowUntil;
}
function noteOk() { _slowHits = 0; }
function noteSlow() {
  _slowHits += 1;
  if (_slowHits < SLOW_NEED) return;
  _slowHits = 0;
  _slowUntil = Date.now() + SLOW_PAUSE_MS;
}

async function httpFetch(url: string, init: RequestInit = {}): Promise<{ status: number; body: ArrayBuffer; headers: Headers }> {
  if (netPaused()) throw new Error("AIP SUP đang chậm, bỏ qua tải mạng");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TO_MS);
  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal, headers: { "User-Agent": UA, ...(init.headers || {}) } });
    const body = await resp.arrayBuffer();
    noteOk();
    return { status: resp.status, body, headers: resp.headers };
  } catch (exc) {
    if ((exc as Error)?.name === "AbortError") noteSlow();
    throw exc;
  } finally {
    clearTimeout(timer);
  }
}

function getSetCookies(headers: Headers): string[] {
  const anyH = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyH.getSetCookie === "function") return anyH.getSetCookie();
  const one = headers.get("set-cookie");
  return one ? [one] : [];
}
function cookieValue(sets: string[], name: string): string {
  for (const raw of sets) {
    const m = new RegExp(`^${name}=([^;]+)`, "i").exec(raw.trim());
    if (m) return m[1]!;
  }
  return "";
}

async function pdfText(buf: ArrayBuffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const { text } = await extractText(new Uint8Array(buf), { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : String(text || "");
}

// ---------- accounts ----------
interface Account { adapter?: string; firs?: string[]; user?: string; password?: string }

function loadAccounts(): Account[] {
  const raw = process.env["AIP_ACCOUNTS_JSON"];
  if (!raw) return [];
  try {
    const js = JSON.parse(raw);
    const rows = Array.isArray(js) ? js : js?.portals;
    return Array.isArray(rows) ? rows.filter((r) => r && typeof r === "object") : [];
  } catch {
    return [];
  }
}

function accountFor(fir: string, adapter = ""): Account | null {
  const code = String(fir || "").toUpperCase().replace(/[^A-Z]/g, "");
  const want = adapter.toLowerCase();
  const rows = loadAccounts();
  for (const row of rows) {
    const ad = String(row.adapter || "").toLowerCase();
    if (want && ad !== want) continue;
    const firs = (row.firs || []).map((x) => String(x).toUpperCase());
    if (!code || firs.includes(code)) return row;
    if (code.startsWith("RJ") && ad === "jp_swim") return row;
    if (code.startsWith("Y") && ad === "au_airservices") return row;
  }
  if (want) {
    for (const row of rows) if (String(row.adapter || "").toLowerCase() === want) return row;
  }
  return null;
}

function adapterFor(fir: string): string {
  const code = String(fir || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (code.startsWith("Y")) return "au_airservices";
  const row = accountFor(code);
  const ad = String(row?.adapter || "");
  if (ad) return ad;
  if (code === "RCAA" || code.startsWith("RC")) return "tw_eaip";
  if (!code || code.startsWith("RJ") || code === "RJJJ") return "jp_swim";
  return "";
}

// ---------- cache (app_settings, key aip_sup:<SUP> / aip_dah) ----------
function cacheKey(sup: string): string {
  return `aip_sup:${sup.toUpperCase()}`;
}

async function readCache(ctx: Ctx, sup: string): Promise<RingTable | null> {
  if (_mem.has(sup)) return _mem.get(sup)!;
  const rec = await getJson<CacheRec | null>(ctx, cacheKey(sup), null);
  if (!rec) return null;
  const age = Date.now() / 1000 - (rec.ts || 0);
  if ((rec.v || 1) < CACHE_VER) return null;
  if (rec.error) return age < FAIL_TTL_S ? {} : null;
  if (rec.hours) _hoursMem.set(sup.toUpperCase(), rec.hours);
  const out: RingTable = {};
  for (const [nr, item] of Object.entries(rec.rings || {})) {
    const ring = (item.ring || []).map(([a, b]) => [Number(a), Number(b)] as Pt);
    if (ring.length >= 3) out[nr] = { name: String(item.name || nr), ring };
  }
  if (Object.keys(out).length && age < OK_TTL_S) {
    _mem.set(sup, out);
    return out;
  }
  return null;
}

async function writeCache(ctx: Ctx, sup: string, table: RingTable, error = ""): Promise<void> {
  const payload: CacheRec = { ts: Date.now() / 1000, v: CACHE_VER };
  if (error) payload.error = error.slice(0, 200);
  else {
    const hours = _hoursMem.get(sup.toUpperCase());
    if (hours) payload.hours = hours;
    payload.rings = {};
    for (const [nr, { name, ring }] of Object.entries(table)) payload.rings[nr] = { name, ring };
  }
  await setJson(ctx, cacheKey(sup), payload);
  if (!error) _mem.set(sup, table);
  else _mem.set(sup, {});
}

const DAH_KEY = "aip_dah";

async function readDahCache(ctx: Ctx): Promise<Record<string, Pt[]> | null> {
  if (_dahMem) return _dahMem;
  const rec = await getJson<DahRec | null>(ctx, DAH_KEY, null);
  if (!rec) return null;
  const age = Date.now() / 1000 - (rec.ts || 0);
  if ((rec.v || 1) < DAH_VER) return null;
  if (rec.error) return age < FAIL_TTL_S ? {} : null;
  const out: Record<string, Pt[]> = {};
  for (const [ident, ring] of Object.entries(rec.rings || {})) {
    const pts = (ring || []).map(([a, b]) => [Number(a), Number(b)] as Pt);
    if (pts.length >= 3) out[ident.toUpperCase()] = pts;
  }
  if (Object.keys(out).length && age < OK_TTL_S) return out;
  return null;
}
async function writeDahCache(ctx: Ctx, rings: Record<string, Pt[]>, error = ""): Promise<void> {
  const payload: DahRec = { ts: Date.now() / 1000, v: DAH_VER };
  if (error) payload.error = error.slice(0, 200);
  else payload.rings = rings;
  await setJson(ctx, DAH_KEY, payload);
}

// ---------- Japan SWIM ----------
async function loginJapan(user: string, password: string): Promise<[string, string]> {
  const { status, body, headers } = await httpFetch(AUTH_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ id: user, password }),
  });
  const sets = getSetCookies(headers);
  let msmsi = cookieValue(sets, "MSMSI");
  let msmai = cookieValue(sets, "MSMAI");
  if (!msmsi) {
    try {
      const js = JSON.parse(new TextDecoder().decode(body));
      if (js && typeof js === "object") {
        msmsi = String(js.MSMSI || msmsi);
        msmai = String(js.MSMAI || msmai);
      }
    } catch { /* ignore */ }
  }
  if (status >= 400 || !msmsi || !msmai) throw new Error(`SWIM login HTTP ${status}`);
  return [msmsi, msmai];
}

async function swimHeaders(): Promise<Record<string, string>> {
  const acc = accountFor("RJJJ", "jp_swim") || accountFor("RJJJ");
  const user = String(acc?.user || "").trim();
  const password = String(acc?.password || "");
  if (!user || !password) throw new Error("thiếu user/pass Nhật trong AIP_ACCOUNTS_JSON");
  const now = Date.now();
  if (_swim && now - _swim.at < 50 * 60 * 1000) {
    return { Cookie: `MSMSI=${_swim.msmsi}; MSMAI=${_swim.msmai}`, Accept: "*/*" };
  }
  const [msmsi, msmai] = await loginJapan(user, password);
  _swim = { msmsi, msmai, at: now };
  return { Cookie: `MSMSI=${msmsi}; MSMAI=${msmai}`, Accept: "*/*" };
}

async function japanCycles(headers: Record<string, string>): Promise<string[]> {
  const fallback = ["20260903", "20260806"];
  try {
    const { status, body } = await httpFetch(`${AIP_BASE}/f2eapr/AIP/html/history-en-JP.html`, { headers });
    if (status >= 400) return fallback;
    const html = new TextDecoder().decode(body);
    const out: string[] = [];
    for (const m of html.matchAll(/\/(\d{8})\/(?:eSUP|eAIP)\//g)) if (!out.includes(m[1]!)) out.push(m[1]!);
    for (const d of fallback) if (!out.includes(d)) out.push(d);
    return out.slice(0, 8);
  } catch {
    return fallback;
  }
}

async function japanPdfUrl(sup: string, headers: Record<string, string>): Promise<string> {
  const [numS, yy] = sup.split("/");
  const year = 2000 + parseInt(yy!, 10);
  const num = parseInt(numS!, 10);
  const pad = String(num).padStart(3, "0");
  const fname = `JP-eSUP-${year}-${pad}-en-JP.pdf`;
  for (const cycle of await japanCycles(headers)) {
    const index = `${AIP_BASE}/f2eapr/AIP/html/${cycle}/eSUP/JP-eSUPs-en-JP.html`;
    const idx = await httpFetch(index, { headers });
    if (idx.status >= 400) continue;
    const html = new TextDecoder().decode(idx.body);
    let hit = new RegExp(`href="(pdf/JP-eSUP-${year}-${pad}-en-JP\\.pdf)"[^>]*>\\s*${num}/${yy}`, "i").exec(html);
    if (!hit) hit = new RegExp(`href="(pdf/${fname.replace(/[.]/g, "\\.")})"`, "i").exec(html);
    if (hit) return `${AIP_BASE}/f2eapr/AIP/html/${cycle}/eSUP/${hit[1]}`;
    const direct = `${AIP_BASE}/f2eapr/AIP/html/${cycle}/eSUP/pdf/${fname}`;
    try {
      const probe = await httpFetch(direct, { headers });
      if (probe.status < 400) return direct;
    } catch { /* try next cycle */ }
  }
  throw new Error(`không thấy PDF SUP ${sup}`);
}

async function fetchJapan(sup: string): Promise<RingTable> {
  const headers = await swimHeaders();
  const url = await japanPdfUrl(sup, headers);
  const { status, body } = await httpFetch(url, { headers });
  const bytes = new Uint8Array(body);
  if (status >= 400 || bytes[0] !== 0x25) throw new Error(`tải SUP ${sup} HTTP ${status}`);
  const table = p.parse_japan_sup_text(await pdfText(body), sup);
  if (!Object.keys(table).length) throw new Error(`PDF SUP ${sup} không tách được tọa độ`);
  return table;
}

async function fetchAustralia(sup: string): Promise<RingTable> {
  const m = /^([A-Z]?)(\d{1,3})\/(\d{2})$/.exec(sup.toUpperCase());
  if (!m) throw new Error(`SUP Úc không hiểu: ${sup}`);
  const letter = (m[1] || "H").toLowerCase();
  const num = parseInt(m[2]!, 10), yy = m[3];
  let urls = [
    `https://www.airservicesaustralia.com/aip/current/sup/s${yy}-${letter}${num}.pdf`,
    `https://www.airservicesaustralia.com/aip/current/sup/s${yy}-${num}.pdf`,
  ];
  if (!m[1]) {
    urls = [
      `https://www.airservicesaustralia.com/aip/current/sup/s${yy}-h${num}.pdf`,
      `https://www.airservicesaustralia.com/aip/current/sup/s${yy}-c${num}.pdf`,
      ...urls,
    ];
  }
  let body: ArrayBuffer | null = null;
  for (const url of urls) {
    try {
      const resp = await httpFetch(url);
      if (resp.status < 400 && new Uint8Array(resp.body)[0] === 0x25) { body = resp.body; break; }
    } catch { /* try next */ }
  }
  if (!body) throw new Error(`không thấy PDF SUP Úc ${sup}`);
  const text = await pdfText(body);
  const table = p.parse_australia_sup_text(text, sup);
  if (Object.keys(table).length) return table;
  const ids = p.au_sup_area_ids(text);
  const out: RingTable = {};
  for (const ident of ids) {
    const ring = await dah_ring(ident);
    if (ring.length >= 3) out[ident] = { name: ident, ring };
  }
  if (Object.keys(out).length) return out;
  throw new Error(`PDF SUP ${sup} không tách được tọa độ`);
}

function twUrl(...parts: string[]): string {
  const bits: string[] = [];
  for (const part of parts) for (const bit of String(part || "").replace(/\\/g, "/").split("/")) if (bit) bits.push(bit);
  return TW_EAIP + bits.map((b) => encodeURIComponent(b)).join("/");
}

async function twCycles(): Promise<string[]> {
  try {
    const { status, body } = await httpFetch(twUrl("default.html"));
    if (status >= 400) return [];
    const html = new TextDecoder().decode(body);
    const out: string[] = [];
    for (const hit of html.matchAll(/href="(AIRAC[^"]+?)(?:\\|\/)?index\.html"/gi)) {
      const folder = hit[1]!.replace(/\\/g, "/").replace(/\/[^/]*$/, "").replace(/^\/+|\/+$/g, "");
      if (folder && !out.includes(folder)) out.push(folder);
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchTaiwan(sup: string): Promise<RingTable> {
  const m = /^(\d{1,3})\/(\d{2})$/.exec(sup.toUpperCase());
  if (!m) throw new Error(`SUP Đài Loan không hiểu: ${sup}`);
  const want = `${parseInt(m[1]!, 10)}-${m[2]}_`;
  let last = "";
  for (const cycle of await twCycles()) {
    const menuUrl = twUrl(cycle, "eSUP", "menu.html");
    const menu = await httpFetch(menuUrl);
    last = `menu HTTP ${menu.status}`;
    if (menu.status >= 400) continue;
    const html = new TextDecoder().decode(menu.body);
    let href = "";
    for (const link of html.matchAll(/href=['"](\d{1,3}-\d{2}_[^'"#]+\/SUP-en-GB\.html)(?:#[^'"]*)?['"]/gi)) {
      const norm = link[1]!.replace(/\\/g, "/");
      if (norm.startsWith(want)) { href = norm; break; }
    }
    if (!href) { last = `không thấy ${sup} trong ${cycle}`; continue; }
    const page = twUrl(cycle, "eSUP", href);
    const resp = await httpFetch(page);
    if (resp.status >= 400) { last = `SUP HTTP ${resp.status}`; continue; }
    const html2 = new TextDecoder().decode(resp.body);
    const table = p.parse_taiwan_sup_text(html2, sup);
    if (Object.keys(table).length) {
      const hours = p.parse_taiwan_sup_hours(html2);
      if (hours) _hoursMem.set(sup.toUpperCase(), hours);
      return table;
    }
    last = "HTML không tách được tọa độ";
  }
  throw new Error(`không lấy được SUP Đài Loan ${sup}: ${last}`);
}

async function fetchDah(): Promise<Record<string, Pt[]>> {
  let body: ArrayBuffer | null = null;
  for (const url of DAH_PDF) {
    try {
      const resp = await httpFetch(url);
      if (resp.status < 400 && new Uint8Array(resp.body)[0] === 0x25) { body = resp.body; break; }
    } catch { /* try next */ }
  }
  if (!body) throw new Error("không thấy PDF DAH Airservices");
  const table = p.parse_australia_dah_text(await pdfText(body));
  if (!Object.keys(table).length) throw new Error("PDF DAH không tách được tọa độ");
  return table;
}

async function dahRings(ctx: Ctx): Promise<Record<string, Pt[]>> {
  if (_dahMem) return _dahMem;
  const cached = await readDahCache(ctx);
  if (cached !== null) { _dahMem = cached; return cached; }
  try {
    const table = await fetchDah();
    await writeDahCache(ctx, table);
    _dahMem = table;
    return table;
  } catch (exc) {
    await writeDahCache(ctx, {}, String((exc as Error)?.message || exc));
    _dahMem = {};
    return _dahMem;
  }
}

/** Ctx is bound per-request; call bindCtx once per request before dah_ring/dah_named/rings_of. */
let _boundCtx: Ctx | null = null;
export function bindCtx(ctx: Ctx): void {
  _boundCtx = ctx;
}

export async function dah_ring(ident: string, fir = ""): Promise<Pt[]> {
  const key = String(ident || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (!/^[MRDP]\d{3,4}[A-Z]?$/.test(key)) return [];
  const code = String(fir || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (code && !code.startsWith("Y")) return [];
  if (!_boundCtx) return [];
  return [...((await dahRings(_boundCtx))[key] || [])];
}

export async function dah_named(ident: string, fir = ""): Promise<Pt[]> {
  const code = String(fir || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (code && !code.startsWith("Y")) return [];
  let key = String(ident || "").toUpperCase().replace(/\s+/g, " ").trim();
  key = key.replace(/^Y[A-Z]{3}(?:-Y[A-Z]{3})?\//, "");
  if (!_boundCtx) return [];
  return [...((await dahRings(_boundCtx))[key] || [])];
}

export async function rings_of(sup: string, fir = ""): Promise<RingTable> {
  const key = String(sup || "").trim().toUpperCase();
  if (!/^[A-Z]?\d{1,3}\/\d{2}$/.test(key)) return {};
  if (!_boundCtx) return {};
  const ctx = _boundCtx;
  const cached = await readCache(ctx, key);
  if (cached !== null) return cached;
  const kind = adapterFor(fir);
  const fetchFn = ({ jp_swim: fetchJapan, au_airservices: fetchAustralia, tw_eaip: fetchTaiwan } as Record<string, (s: string) => Promise<RingTable>>)[kind];
  if (!fetchFn) return {};
  if (netPaused()) return {};
  try {
    const table = await fetchFn(key);
    await writeCache(ctx, key, table);
    return table;
  } catch (exc) {
    await writeCache(ctx, key, {}, String((exc as Error)?.message || exc));
    return {};
  }
}

export async function hours_of(sup: string, fir = ""): Promise<string> {
  const key = String(sup || "").trim().toUpperCase();
  if (!key) return "";
  if (!_hoursMem.has(key)) await rings_of(key, fir);
  return _hoursMem.get(key) || "";
}

export { adapterFor as adapter_for, netPaused as net_paused };
