import { env as credEnv } from "../creds.server";
import { checkOfpRules, cleanOfpRules, DEFAULT_OFP_RULES, parseWaypointTimes, type OfpRule } from "../port/ofp_rules";
import type { Jobs, Routes } from "../types";
import type { Flight } from "../core/models";
import { applyFilters, listDispatchers, loadFlights } from "../core/gantts.server";
import { attchCheck, attchContext, type AttchCtx, type AttchResult } from "../port/attch";
import { checkFlightLimits, needsOfpLimitCheck, type LimitsData } from "../port/limits_check";
import { ofpAckNeeded } from "../port/verify";
import { adviceForFlight, type TafRec, type TafSnapshot } from "../port/taf";
import { getJson, setJson } from "../store.server";
import { MARGIN_KG, OfpError, parseWeights, type Weights } from "../port/ofp_weights";
import * as omni from "../port/omni";
import { saveBrowserToken } from "../omni_session.server";
import { getSnapshot, hasOooi, matchTrack, overlayOf, type Track } from "../opscore.server";
import * as jetplan from "../jetplan.server";
import * as pcr from "../port/pcr_limits";

const EMPTY_LIMITS: LimitsData = { aircraft: [], airports: [], curfew: [], special: [] };

// ---------------- api/opscore.py (login-free part: FliteBrief OOOI fallback) ----------------
const PHASE_LABELS: Record<string, string> = {
  ground: "On Ground", taxi: "Taxi", takeoff: "Take Off", airborne: "Airborne",
  landed: "Landed", in: "In", completed: "Completed", unknown: "—",
};
const TAKEOFF_GRACE_S = 12 * 60;
const IN_DONE_S = 5 * 60;

function unixOf(d: Date | null): number | null {
  return d ? Math.trunc(d.getTime() / 1000) || null : null;
}
function isoOfUnix(ts: number | null): string | null {
  return ts ? new Date(ts * 1000).toISOString() : null;
}

let OPS_TRACKS: Track[] | null = null;
function opscoreLookup(f: Flight, now = new Date()) {
  const tr = OPS_TRACKS ? matchTrack(f, OPS_TRACKS, now) : null;
  if (tr && hasOooi(tr)) return overlayOf(tr, now);
  const actualOut = unixOf(f.off_blocks), actualOff = unixOf(f.off_ground);
  const actualOn = unixOf(f.on_ground), actualIn = unixOf(f.in_blocks);
  if (!actualOut && !actualOff && !actualOn && !actualIn) {
    return { ops_phase: "ground", ops_label: PHASE_LABELS["ground"], ops_inferred: false, off_blocks: null, off_ground: null, on_ground: null, in_blocks: null };
  }
  const clockS = now.getTime() / 1000;
  let phase: string;
  if (actualIn) phase = clockS - actualIn >= IN_DONE_S ? "completed" : "in";
  else if (actualOn) phase = "landed";
  else if (actualOff) {
    const age = clockS - actualOff;
    phase = age >= 0 && age < TAKEOFF_GRACE_S ? "takeoff" : "airborne";
  } else phase = "taxi";
  return {
    ops_phase: phase,
    ops_label: PHASE_LABELS[phase] ?? "—",
    ops_inferred: true,
    off_blocks: isoOfUnix(actualOut),
    off_ground: isoOfUnix(actualOff),
    on_ground: isoOfUnix(actualOn),
    in_blocks: isoOfUnix(actualIn),
  };
}

// ---------------- api/atfm.py: no VATM poller here -> always "no CTOT" ----------------
function atfmLookup(_f: Flight): { ctot: string | null } {
  return { ctot: null };
}

// ---------------- web.py dest_alts_for_row ----------------
function destAltsForRow(f: Flight): string[] {
  const bits = [f.dest_alt1, f.dest_alt2, String((f.raw || {})["dest_alt3"] ?? "")];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of bits) {
    const code = String(item || "").trim().toUpperCase();
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}

// ofp_warns_of (web.py): we never cache a read-OFP acknowledgement across
// requests in a Worker, so this is always a fresh compute like a cache miss.
function ofpWarnsOf(_f: Flight, _revision: string): null {
  return null;
}

/** Port of web.py `row()`. */
export function row(f: Flight, limits: LimitsData | null = EMPTY_LIMITS, attch: AttchResult | null = null, revision = "0", tafs: Record<string, TafRec> | null = null) {
  const lim = limits ?? EMPTY_LIMITS;
  const warns = ofpWarnsOf(f, revision) ?? checkFlightLimits(f, lim);
  const ops = opscoreLookup(f);
  const ctot = atfmLookup(f);
  return {
    id: f.id,
    callsign: f.callsign,
    route: f.route,
    dep: f.dep_icao,
    dest: f.dest_icao,
    dep_iata: f.dep_iata || "",
    dest_iata: f.dest_iata || "",
    std: f.std ? f.std.toISOString() : null,
    sta: f.sta ? f.sta.toISOString() : null,
    ops_phase: ops.ops_phase,
    ops_label: ops.ops_label,
    ops_inferred: !!ops.ops_inferred,
    off_blocks: ops.off_blocks,
    off_ground: ops.off_ground,
    on_ground: ops.on_ground,
    in_blocks: ops.in_blocks,
    ctot: ctot.ctot,
    reg: f.reg,
    ac_type: f.ac_type || f.acft_type,
    plan_no: f.plan_no || "",
    plan_released_on: f.plan_released_on ? f.plan_released_on.toISOString() : "",
    gantt_tow: f.planned_takeoff_weight ? Math.trunc(f.planned_takeoff_weight) : null,
    gantt_lwt: f.landing_weight ? Math.trunc(f.landing_weight) : null,
    etops: !!f.etops,
    dispatcher: f.dispatcher.split(/\s+/).filter(Boolean).join(" "),
    crew_count: f.crew_count,
    attachment_count: f.attachment_count,
    pdf_count: f.pdf_attachments.length,
    reg_atch: f.reg_attachment ? String(f.reg_attachment.reg_code || "") : "",
    reg_atch_file: f.reg_attachment ? String(f.reg_attachment.original_filename || f.reg_attachment.title || "") : "",
    status: f.status,
    ofp_status: f.ofp_status,
    ofp_ack: ofpAckNeeded(f),
    has_ofp: !!f.has_ofp,
    verified_by: f.verified_by_name || "",
    verified_on: f.verified_on ? f.verified_on.toISOString() : "",
    fuel_order: fuelOrderOf(f),
    capt_sign: f.sector_accepted_by_name || ((f.crews || []).find((c) => c.is_captain && c.is_sector_accepted)?.full_name ?? ""),
    alternates: destAltsForRow(f),
    extra_fuel: f.planned_extra_fuel || 0,
    // web.py ofp.extra_of(f.id)[1]: minutes only known after reading the OFP
    // PDF — never cached across a request in a Worker, so this is always null.
    extra_time: null as string | null,
    fuel_units: f.fuel_units || "KG",
    pib_wx: f.pib_wx_status,
    has_pib: f.has_pib,
    has_wx: f.has_wx,
    attch: attch ?? attchCheck(f),
    taf_wx: adviceForFlight(f.dest_icao, f.sta ? f.sta.toISOString() : null, tafs),
    limit_warns: warns,
    needs_ofp_limit_check: needsOfpLimitCheck(f, lim),
  };
}

/** Port of web.py `detail()` — crews/fuel/jetplan extras for one flight. */
function fuelOrderOf(f: Flight): { amount: number; units: string } | null {
  const hits: [string, number, string][] = [];
  for (const ev of f.audit) {
    if (!ev || typeof ev !== "object") continue;
    if (String((ev as Record<string, unknown>)["action"] || "").trim().toLowerCase() !== "sector fuel_order_received") continue;
    const info = (ev as Record<string, unknown>)["additionalInfo"];
    const infoObj = info && typeof info === "object" ? (info as Record<string, unknown>) : {};
    const amt = Number(infoObj["amount"]);
    if (!Number.isFinite(amt)) continue;
    const unit = String(infoObj["fuelUnit"] || f.fuel_units || "KG");
    hits.push([String((ev as Record<string, unknown>)["datetime"] || ""), amt, unit]);
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const last = hits[hits.length - 1]!;
  return { amount: last[1], units: last[2] };
}

function detail(f: Flight, crews: Flight["crews"], load: Record<string, unknown> = {}) {
  return {
    ...row(f),
    fltno: f.fltno,
    voyage_id: f.voyage_id,
    plan_id: f.plan_id,
    dep_name: f.dep_name,
    dest_name: f.dest_name,
    dep_iata: f.dep_iata,
    dest_iata: f.dest_iata,
    etd: f.etd ? f.etd.toISOString() : null,
    eta: f.eta ? f.eta.toISOString() : null,
    eet: f.eet,
    fuel: {
      block: f.planned_fuel_total || f.planned_fuel,
      taxi: f.planned_taxi_fuel,
      reserve: f.planned_reserve_fuel,
      alternate: f.planned_alt_fuel,
      contingency: f.planned_con_fuel,
      extra: f.planned_extra_fuel,
      units: f.fuel_units,
    },
    tow: f.planned_takeoff_weight,
    lw: f.landing_weight,
    zfw: Number((f.raw as Record<string, unknown>)["planned_ezfm"]) || null,
    pax_total: f.pax_total,
    cargo: f.cargo,
    load,
    fuel_order: fuelOrderOf(f),
    released_by: f.released_by_name,
    verified_by: f.verified_by_name,
    route_description: f.route_description,
    // jetplan_ac.specs(reg) needs the PC helper's local cache — not available
    // in a Worker, so we omit it like web.py would with an empty cache.
    jetplan: null,
    crews: crews.map((c) => ({ job: c.job_name, name: c.full_name, username: c.username, accepted: c.is_sector_accepted })),
    attachments: f.attachments.map((a) => ({
      id: a.id,
      sector_id: a.sector_id,
      title: a.title,
      filename: a.original_filename,
      is_pdf: a.is_pdf,
      deleted: a.is_deleted,
      created_by: a.created_by,
      created_on: a.created_on ? a.created_on.toISOString() : null,
    })),
    audit: f.audit.slice(-15).map((e) => {
      const ev = e as Record<string, unknown>;
      return {
        time: ev["datetime"],
        action: ev["action"],
        who: `${ev["forename"] || ""} ${ev["surname"] || ""}`.trim(),
      };
    }),
  };
}


// ---------------- api/ofp.py get_weights_bulk / extra_status / omni (worker port) ----------------
// Worker has no local disk cache keyed by PDF hash, so we cache the parsed
// Weights dict per sector id in app_settings with a 10-minute TTL instead of
// web.py's on-disk {id}.json + pdf-hash check. cache=1 (revalidate=false in
// Python) reuses that cache without hitting FliteBrief; otherwise we always
// fetch fresh, same as web.py's default revalidate=True.
const OFP_WEIGHTS_TTL_MS = 10 * 60 * 1000;

interface CachedWeights {
  w: Record<string, unknown>;
  at: number;
}

function planKeyOf(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s;
}

/** Port of web.py `ofp.cache_stale_vs_gantt`. */
function cacheStaleVsGantt(w: Record<string, unknown> | null, flight: Flight | undefined | null): boolean {
  if (w == null || flight == null) return false;
  const fp = planKeyOf(flight.plan_no);
  const wp = planKeyOf(w["plan_no"]);
  if (fp && wp && fp !== wp) return true;
  const gtow = flight.planned_takeoff_weight;
  const glwt = flight.landing_weight;
  const tow = w["tow"] as number | null;
  const lwt = w["lwt"] as number | null;
  if (gtow && tow != null && Math.abs(Number(tow) - Number(gtow)) > 1) return true;
  if (glwt && lwt != null && Math.abs(Number(lwt) - Number(glwt)) > 1) return true;
  return false;
}

async function fetchOneWeight(
  ctx: Parameters<Routes["GET /api/weights"]>[0],
  sectorId: number,
  revalidate: boolean,
): Promise<Record<string, unknown> | null> {
  const key = `ofp.w.${sectorId}`;
  if (!revalidate) {
    const cached = await getJson<CachedWeights | null>(ctx, key, null);
    if (cached && cached.w && "wpts" in cached.w && Date.now() - cached.at < OFP_WEIGHTS_TTL_MS) return cached.w;
  }
  const readCacheFallback = async (): Promise<Record<string, unknown> | null> => {
    const cached = await getJson<CachedWeights | null>(ctx, key, null);
    return cached ? cached.w : null;
  };
  try {
    const { fbGet } = await import("@/lib/flitebrief.server");
    // Thử /ofp trước; không được thì dò đường dẫn View OFP (/ofp/0) như code gốc.
    let res = await fbGet(`/webapi/sectors/${sectorId}/ofp`, "application/pdf");
    if (!res.ok || res.status === 204) {
      res = await fbGet(`/webapi/sectors/${sectorId}/ofp/0`, "application/pdf");
    }
    if (!res.ok || res.status === 204) return readCacheFallback();
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return readCacheFallback();
    let w: Weights;
    let ofpText = "";
    try {
      const { ofpTextFromPdf, parseOperationalText } = await import("../port/ofp_weights");
      try {
        ofpText = await ofpTextFromPdf(buf);
      } catch (exc) {
        throw new OfpError(`đọc PDF lỗi: ${String(exc)}`);
      }
      w = parseOperationalText(ofpText, sectorId);
    } catch (exc) {
      if (exc instanceof OfpError) return readCacheFallback();
      throw exc;
    }
    const dict = w.toDict();
    const wt = parseWaypointTimes(ofpText);
    dict["etd"] = wt.etd;
    dict["wpts"] = wt.wpts;
    await setJson(ctx, key, { w: dict, at: Date.now() } satisfies CachedWeights);
    return dict;
  } catch {
    return readCacheFallback();
  }
}

/** Port of web.py `api.ofp.get_weights_bulk` (network part only — no JetPlan/PCR, ported elsewhere if needed). */
async function getWeightsBulk(
  ctx: Parameters<Routes["GET /api/weights"]>[0],
  sectorIds: number[],
  revalidate: boolean,
): Promise<Map<number, Record<string, unknown>>> {
  const ids = Array.from(new Set(sectorIds));
  const out = new Map<number, Record<string, unknown>>();
  const CONCURRENCY = 6;
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const i = next++;
      const sectorId = ids[i]!;
      const w = await fetchOneWeight(ctx, sectorId, revalidate);
      if (w) out.set(sectorId, w);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()));
  return out;
}

/** Port of web.py `_limits_revision()` — mtime of limits.json. We store limits
 * in app_settings instead of a file, so use that row's updated_at as the
 * revision marker (falls back to "0" like a missing file). */
async function loadOfpRules(ctx: Parameters<Routes["GET /api/weights"]>[0]): Promise<OfpRule[]> {
  const raw = await getJson<unknown>(ctx, "ofp_check_rules", null);
  return Array.isArray(raw) ? cleanOfpRules(raw) : DEFAULT_OFP_RULES;
}

async function limitsRevision(ctx: Parameters<Routes["GET /api/weights"]>[0]): Promise<string> {
  try {
    const { data } = await ctx.supabase.from("app_settings").select("updated_at").eq("key", "limits").maybeSingle();
    return data?.updated_at ? String(new Date(data.updated_at as string).getTime() / 1000) : "0";
  } catch {
    return "0";
  }
}

const OMNI_NO_ACCOUNT_ERROR = { error: "Chưa có tài khoản Omni — gửi cho quản trị để lưu (OMNI_USERNAME/OMNI_PASSWORD)." };

function omniCreds(): omni.OmniCredentials | null {
  const username = credEnv("OMNI_USERNAME");
  const password = credEnv("OMNI_PASSWORD");
  return username && password ? { username, password } : null;
}

// Replaces web.py's in-process `_OMNI_CACHE` (RAM, shared by threads): Workers
// share no memory, so the merged OmniFlight rows + fetched-at live in
// app_settings (key "omni.cache") instead, keyed like web.py's `_omni_key`
// (digits, dep, arr, std_local minute).
type OmniCacheRow = Omit<omni.OmniFlight, "std_local" | "cot_utc" | "est_time_utc"> & {
  std_local: string | null;
  cot_utc: string | null;
  est_time_utc: string | null;
};
interface OmniCache {
  rows: OmniCacheRow[];
  at: number; // epoch seconds, like web.py's time.time()
}
const EMPTY_OMNI_CACHE: OmniCache = { rows: [], at: 0 };

function toCacheRow(x: omni.OmniFlight): OmniCacheRow {
  return { ...x, std_local: x.std_local?.toISOString() ?? null, cot_utc: x.cot_utc?.toISOString() ?? null, est_time_utc: x.est_time_utc?.toISOString() ?? null };
}
function fromCacheRow(r: OmniCacheRow): omni.OmniFlight {
  return { ...r, std_local: r.std_local ? new Date(r.std_local) : null, cot_utc: r.cot_utc ? new Date(r.cot_utc) : null, est_time_utc: r.est_time_utc ? new Date(r.est_time_utc) : null };
}
function omniKey(r: OmniCacheRow): string {
  return `${r.digits}|${r.dep}|${r.arr}|${r.std_local ?? ""}`;
}

/** Port of web.py `_omni_merge` — gộp danh sách OmniFlight vào cache. */
function omniMerge(cache: OmniCache, rows: omni.OmniFlight[]): number {
  const byKey = new Map(cache.rows.map((r) => [omniKey(r), r] as const));
  let added = 0;
  for (const r of rows) {
    const row = toCacheRow(r);
    const k = omniKey(row);
    if (!byKey.has(k)) added++;
    byKey.set(k, row);
  }
  // Keep only today's and tomorrow's flights (Vietnam date) — old sectors are useless.
  const vnDay = (ms: number) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
  const today = vnDay(Date.now()), tomorrow = vnDay(Date.now() + 86400_000);
  cache.rows = Array.from(byKey.values()).filter((r) => {
    if (!r.std_local) return false;
    const d = r.std_local.slice(0, 10); // naive local wall-clock date
    return d === today || d === tomorrow;
  });
  cache.at = Math.floor(Date.now() / 1000);
  return added;
}

/** Port of web.py `omni_refresh()`. */
async function omniRefresh(ctx: Parameters<Routes["GET /api/weights"]>[0], creds: omni.OmniCredentials) {
  const cache = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
  const rows = await omni.fetchOmni(creds);
  const added = omniMerge(cache, rows);
  await setJson(ctx, "omni.cache", cache);
  return { total: cache.rows.length, added, fetched: rows.length, at: cache.at };
}

/** Port of web.py `_omni_rows()` — trả cache; nếu rỗng thì fetch lần đầu. */
async function omniRowsFor(ctx: Parameters<Routes["GET /api/weights"]>[0], creds: omni.OmniCredentials): Promise<omni.OmniFlight[]> {
  const cache = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
  if (cache.rows.length) return cache.rows.map(fromCacheRow);
  await omniRefresh(ctx, creds);
  const refreshed = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
  return refreshed.rows.map(fromCacheRow);
}

/** Port of web.py `_omni_load_of` — Bag/CGO/PAX/EST từ Omni cache, không gọi mạng. */
async function omniLoadOf(ctx: Parameters<Routes["GET /api/weights"]>[0], f: Flight): Promise<Record<string, unknown>> {
  try {
    const cache = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
    if (!cache.rows.length) return {};
    const mt = omni.match([f], cache.rows.map(fromCacheRow)).get(f.id);
    if (!mt) return {};
    const x = mt.omni;
    return { pax: x.pax_weight, bag: x.bag_weight, cargo: x.cargo_confirm, tare: x.tare, est: x.est_payload };
  } catch {
    return {};
  }
}

/** Port of web.py `est_check()` — EST từ InFlight Omni cho từng chuyến. */
async function estCheck(ctx: Parameters<Routes["GET /api/weights"]>[0], flights: Flight[], creds: omni.OmniCredentials) {
  const out: Record<string, unknown> = {};
  if (!flights.length) return out;
  let rows: omni.OmniFlight[];
  try {
    rows = await omniRowsFor(ctx, creds);
  } catch (exc) {
    const msg = `Omni: ${exc instanceof Error ? exc.message : String(exc)}`;
    for (const f of flights) out[String(f.id)] = { err: msg };
    return out;
  }
  const m = omni.match(flights, rows);
  for (const f of flights) {
    const mt = m.get(f.id);
    if (!mt) {
      out[String(f.id)] = { err: "không thấy chuyến này trên Omni" };
      continue;
    }
    out[String(f.id)] = {
      est: mt.omni.est_payload,
      omni: omni.omniLabel(mt.omni),
      gap_h: Math.round(mt.gap_h * 10) / 10,
      pax: mt.omni.pax_weight, bag: mt.omni.bag_weight,
      cargo: mt.omni.cargo_confirm, tare: mt.omni.tare,
      note: mt.note,
      est_time: mt.omni.est_time_utc ? mt.omni.est_time_utc.toISOString() : null,
      omni_std: mt.omni.std_local ? mt.omni.std_local.toISOString() : null,
      err: "",
    };
  }
  return out;
}

// Port of the web.py endpoints for group "core". Keep JSON shapes identical to web.py.
export const routes: Routes = {
  // Web app has real login, so the local passcode gate is always open.
  "GET /api/gate/status": () => ({ unlocked: true, default_password: false, locked: false, fails: 0, max_tries: 5 }),
  "POST /api/gate/lock": () => ({ ok: true, locked: false }),
  "POST /api/gate/unlock": () => ({ ok: true, unlocked: true }),
  "POST /api/gate/enter": () => ({ ok: true, unlocked: true }),
  "GET /api/heartbeat": () => ({ ok: true }),
  // Omni chặn tạo token từ máy chủ cloud → trình duyệt dispatcher đăng nhập rồi gửi token lên.
  "GET /api/omni/login-user": () => ({ username: credEnv("OMNI_USERNAME") || "" }),
  "POST /api/omni/token": async (ctx) => {
    const body = await ctx.json();
    const username = credEnv("OMNI_USERNAME") || String(body["username"] || "").trim();
    if (!username) return { error: "chưa có tài khoản Omni" };
    try {
      return await saveBrowserToken(username, String(body["token"] || ""));
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
  "GET /api/tab-close": () => ({ ok: true }),
  "POST /api/tab-close": () => ({ ok: true }),
  "POST /api/quit": () => ({ ok: true }),
  "POST /api/stop": async () => {
    const { cancelAll } = await import("../pcagent.server");
    return { ok: true, count: await cancelAll() };
  },
  "GET /api/extra": () => ({ ready: false, count: 0, times: {} }),
  "GET /api/est/status": async (ctx) => {
    const cache = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
    return { total: cache.rows.length, at: cache.at || null };
  },
  "GET /api/est/refresh": async (ctx) => {
    const creds = omniCreds();
    if (!creds) return OMNI_NO_ACCOUNT_ERROR;
    try {
      return await omniRefresh(ctx, creds);
    } catch (exc) {
      return { error: exc instanceof Error ? exc.message : String(exc) };
    }
  },
  "GET /api/est/match": async (ctx) => {
    const { params } = ctx;
    const ids = new Set(
      (params.get("ids") || "").split(",").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).map(Number),
    );
    const days = parseInt(params.get("days") || "1", 10) || 1;
    const flights = ids.size ? (await loadFlights(days)).filter((f) => ids.has(f.id)) : [];
    const creds = omniCreds();
    const cache = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
    if (!creds) {
      const est: Record<string, unknown> = {};
      for (const f of flights) est[String(f.id)] = { err: "Omni: Chưa có tài khoản — gửi cho quản trị để lưu (OMNI_USERNAME/OMNI_PASSWORD)." };
      return { est, total: cache.rows.length, at: cache.at || null };
    }
    const est = await estCheck(ctx, flights, creds);
    const cacheAfter = await getJson<OmniCache>(ctx, "omni.cache", EMPTY_OMNI_CACHE);
    return { est, total: cacheAfter.rows.length, at: cacheAfter.at || null };
  },
  // web.py's "📂 Omni" manual XLSX upload needs openpyxl-equivalent XLSX parsing
  // of the dashboard export file; not ported yet (no XLSX reader wired for this
  // format here) — tải bằng nút "🔄 EST" (Dashboard OMC JSON) thay thế được.
  "POST /api/est/upload": () => ({ error: "Upload file Omni (XLSX) chưa được port — dùng nút 🔄 EST để lấy trực tiếp." }),
  // web.py's auto-download writes the OMC export to D:\Omni every hour from the
  // dispatcher's PC (local filesystem) — impossible from a Cloudflare Worker.
  "GET /api/omni/auto": () => ({
    enabled: false, busy: false, dest: "D:\\Omni", last_file: "", last_at: 0,
    last_error: "Tự động tải Omni xuống ổ D cần PC helper (không chạy được trên máy chủ web) — dùng nút 🔄 EST để lấy EST trực tiếp.",
    next_at: 0,
  }),
  "POST /api/omni/auto": () => ({
    error: "Tự động tải Omni xuống ổ D cần PC helper (không chạy được trên máy chủ web) — dùng nút 🔄 EST để lấy EST trực tiếp.",
  }),
  "GET /api/ofp/rules": async (ctx) => ({ rules: await loadOfpRules(ctx) }),
  "POST /api/ofp/rules": async (ctx) => {
    const { data: isAdmin } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
    if (!isAdmin) return { error: "Chỉ tài khoản quản trị mới sửa được OFP check data." };
    const body = (await ctx.json()) as Record<string, unknown>;
    if (!Array.isArray(body["rules"])) return { error: "rules phải là danh sách" };
    const rules = cleanOfpRules(body["rules"] as unknown[]);
    await setJson(ctx, "ofp_check_rules", rules);
    return { ok: true, rules };
  },
  "GET /api/weights": async (ctx) => {
    const { params } = ctx;
    const ids = (params.get("ids") || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => /^\d+$/.test(x))
      .map((x) => Number(x));
    if (!ids.length) return { weights: {}, limit_warns: {} };
    if (ids.length > 200) return { error: "tối đa 200 sector mỗi lô" };

    const days = parseInt(params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days);
    const fetchable = new Set(
      flights.filter((f) => ["REL", "PEN", "PRO"].includes((f.ofp_status || "").trim().toUpperCase()) || f.has_ofp).map((f) => f.id),
    );
    const want = ids.filter((i) => fetchable.has(i));
    const byId = new Map(flights.filter((f) => want.includes(f.id)).map((f) => [f.id, f] as const));
    const asked = new Set(ids);
    const planNow: Record<string, { ofp: string; reg: string }> = {};
    for (const f of flights) if (asked.has(f.id)) planNow[String(f.id)] = { ofp: f.ofp_status || "", reg: f.reg || "" };

    const useCacheOnly = params.get("cache") === "1";
    const limits: LimitsData = { ...(await getJson<LimitsData>(ctx, "limits", EMPTY_LIMITS)), acgroups: await getJson(ctx, "limits.acgroups", []) };
    const rev = await limitsRevision(ctx);
    const ofpRules = await loadOfpRules(ctx);

    let ws: Map<number, Record<string, unknown>>;
    try {
      ws = want.length ? await getWeightsBulk(ctx, want, !useCacheOnly) : new Map();
    } catch (exc) {
      return {
        weights: {},
        margin_kg: MARGIN_KG,
        no_ofp: ids.filter((i) => !fetchable.has(i)),
        ofp_failed: want,
        plan_now: planNow,
        limit_warns: {},
        limit_revision: rev,
        ofp_note: exc instanceof Error ? exc.message : String(exc),
      };
    }

    const limitWarns: Record<string, unknown> = {};
    const payload: Record<string, Record<string, unknown>> = {};
    for (const [sectorId, wdict] of ws) {
      const d: Record<string, unknown> = { ...wdict };
      const flight = byId.get(sectorId);
      const stale = cacheStaleVsGantt(wdict, flight);
      if (stale) d["cfp_mismatch"] = true;
      payload[String(sectorId)] = d;
      if (!flight || stale) continue;
      const warns = [...checkFlightLimits(flight, limits, wdict), ...checkOfpRules(flight, ofpRules, wdict)];
      limitWarns[String(sectorId)] = warns;
    }

    try {
      const regs = [...ws.keys()].map((sid) => byId.get(sid)).filter((f) => f && f.reg && !payload[String(f.id)]?.["cfp_mismatch"]).map((f) => f!.reg);
      await jetplan.ensureRegs(ctx, regs);
      for (const [sid, weights] of ws) {
        const flight = byId.get(sid);
        const d = payload[String(sid)]!;
        if (d["cfp_mismatch"]) continue;
        const cap = await jetplan.lookup(ctx, flight ? flight.reg : "");
        if (cap) {
          d["fuel_cap"] = cap.cap;
          d["fuel_cap_type"] = cap.type;
          d["fuel_cap_limit"] = cap.limit;
          d["fleet_mtow"] = cap.mtow;
        }
        if (flight) d["pcr"] = pcr.pack_for_weights(pcr.check_flight(flight, weights, { fleet_mtow: cap?.mtow ?? null }));
      }
    } catch (exc) {
      console.debug("JetPlan AC / PCR:", exc);
    }

    return {
      weights: payload,
      margin_kg: MARGIN_KG,
      no_ofp: ids.filter((i) => !fetchable.has(i)),
      ofp_failed: want.filter((i) => !ws.has(i)),
      plan_now: planNow,
      limit_warns: limitWarns,
      limit_revision: rev,
    };
  },
  "GET /api/dispatchers": async ({ params }) => {
    const days = parseInt(params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days, params.get("refresh") === "1");
    const scoped = applyFilters(flights, params, true);
    return { dispatchers: listDispatchers(scoped), total: scoped.length };
  },
  "GET /api/flights": async (ctx) => {
    const { params } = ctx;
    const days = parseInt(params.get("days") || "1", 10) || 1;
    const refresh = params.get("refresh") === "1";
    const flights = await loadFlights(days, refresh);
    const shown = applyFilters(flights, params);
    const limits: LimitsData = { ...(await getJson<LimitsData>(ctx, "limits", EMPTY_LIMITS)), acgroups: await getJson(ctx, "limits.acgroups", []) };
    OPS_TRACKS = await getSnapshot(ctx, refresh);
    const tafCache = await getJson<TafSnapshot>(ctx, "wx.taf", { tafs: {} } as TafSnapshot);
    const tafs = (tafCache?.tafs || {}) as Record<string, TafRec>;
    const rev = "0";
    const attchCtx: AttchCtx = attchContext();
    // Dùng đúng bộ quy tắc đang lưu trong Notice Rule Studio, không dùng mẫu cũ.
    const savedRules = await getJson<unknown>(ctx, "notice_rules", null);
    const ruleRows = Array.isArray(savedRules) ? savedRules
      : savedRules && typeof savedRules === "object" && Array.isArray((savedRules as { rules?: unknown }).rules)
        ? (savedRules as { rules: unknown[] }).rules : null;
    if (ruleRows) attchCtx.rule_data = ruleRows as AttchCtx["rule_data"];
    return {
      days,
      total: flights.length,
      count: shown.length,
      flights: shown.map((f) => row(f, limits, attchCheck(f, attchCtx), rev, tafs)),
      attachment_total: shown.reduce((n, f) => n + f.pdf_attachments.length, 0),
      fetched_at: null,
      age: null,
      cache_ttl: 300,
    };
  },
  "GET /api/flight/*": async (ctx) => {
    const m = /\/api\/flight\/(\d+)(\/ofp)?$/.exec(ctx.route);
    if (!m) return { error: "sector_id không hợp lệ" };
    const sectorId = Number(m[1]);
    const days = parseInt(ctx.params.get("days") || "1", 10) || 1;
    const flights = await loadFlights(days);
    const flight = flights.find((f) => f.id === sectorId);
    if (m[2]) {
      if (!flight) return new Response("khong thay chuyen", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      try {
        const { fbGet } = await import("@/lib/flitebrief.server");
        const res = await fbGet(`/webapi/sectors/${sectorId}/ofp`, "application/pdf");
        if (!res.ok || res.status === 204) {
          return new Response("chua co OFP PDF tren FliteBrief", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const blob = await res.arrayBuffer();
        if (!blob.byteLength) {
          return new Response("chua co OFP PDF tren FliteBrief", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        return new Response(blob, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Cache-Control": "private, no-store",
            "Content-Disposition": `inline; filename="${flight.callsign || sectorId}-OFP.pdf"`,
          },
        });
      } catch (exc) {
        return new Response(`loi tai OFP: ${exc instanceof Error ? exc.message : String(exc)}`, {
          status: 502,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    }
    if (!flight) return { error: `Không tìm thấy sector ${sectorId}` };
    let crews = flight.crews;
    if (!crews.length && flight.crew_count) {
      try {
        const { fbJson } = await import("@/lib/flitebrief.server");
        const { Crew } = await import("../core/models");
        const data = await fbJson<unknown>(`/webapi/sectors/${sectorId}/crews`);
        const list = Array.isArray(data) ? data : [];
        crews = list.filter((c): c is Record<string, unknown> => !!c && typeof c === "object").map((c) => Crew.fromApi(c, sectorId));
        flight.crews = crews;
      } catch {
        // FliteBrief crews fetch failing shouldn't break the rest of the detail.
      }
    }
    let jp: unknown = null;
    try {
      await jetplan.ensureRegs(ctx, [flight.reg]);
      jp = await jetplan.specs(ctx, flight.reg);
    } catch { /* web.py ignores JetPlan failures here */ }
    return { ...detail(flight, crews, await omniLoadOf(ctx, flight)), jetplan: jp };
  },
};
export const jobs: Jobs = {};
