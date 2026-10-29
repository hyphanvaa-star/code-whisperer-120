// Five-level NOTAM assessment for "Lọc notam tracking chuyến".
// Port of flight_notam_checker (analysis._assess_one, operational_windows,
// schedule.schedule_active_at, geometry.spatial_match branch order). Every NOTAM
// gets exactly one level; nothing is removed from the payload. Every gate is
// tri-state (true = overlap, false = no overlap, null = not enough data): only
// `false` yields NO IMPACT, `null` yields NEED MANUAL CHECK, and a concluded gate
// is never reversed by a later one.
import { notamGeoms, notamAltBand, geomTrackNear, qCoordsOf, type Notam, type TrackPoint } from "./notam_track";
import { parseNotamWhen, normIcao } from "./notam_check";

export type Level = "CRITICAL" | "DELAY-ONLY" | "NEED MANUAL CHECK" | "BRIEFING INFO" | "NO IMPACT";
export const LEVELS: Level[] = ["CRITICAL", "DELAY-ONLY", "NEED MANUAL CHECK", "BRIEFING INFO", "NO IMPACT"];
type Tri = true | false | null;

export interface AssessCfg {
  corridor_nm: number;
  max_delay_minutes: number;
  dep_before: number; dep_after: number;
  arr_before: number; arr_after: number;
  talt_before: number; talt_after: number;
  enrt_alt_after: number;
  dest_alt_before: number; dest_alt_after: number;
  fir_before: number; fir_after: number;
}
export const DEFAULT_ASSESS_CFG: AssessCfg = {
  corridor_nm: 5, max_delay_minutes: 180,
  dep_before: 60, dep_after: 60, arr_before: 60, arr_after: 60,
  talt_before: 15, talt_after: 60, enrt_alt_after: 60,
  dest_alt_before: 60, dest_alt_after: 60, fir_before: 60, fir_after: 60,
};
export function normAssessCfg(raw: unknown): AssessCfg {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_ASSESS_CFG };
  for (const k of Object.keys(out) as (keyof AssessCfg)[]) {
    const v = Number(src[k]);
    if (src[k] !== undefined && src[k] !== "" && Number.isFinite(v) && v >= 0) {
      out[k] = Math.min(k === "corridor_nm" ? 200 : 1440, v);
    }
  }
  out.max_delay_minutes = Math.round(out.max_delay_minutes);
  return out;
}

export type Role = "DEP" | "ARR" | "TALT" | "RALT" | "ALT";
export interface AssessFlight {
  etd: Date | null;
  eta: Date | null;
  roles: Record<string, Role>;
  firs: Record<string, [Date, Date]>;
  points: TrackPoint[];
  tokens: Set<string>;
  sid: string | null;
  star: string | null;
  acType: string;
}
export interface Assessment {
  level: Level;
  earliest_impact_delay_minutes: number | null;
  match_type: string;
  reasons: string[];
}

const MIN = 60_000;
const add = (d: Date, m: number) => new Date(d.getTime() + m * MIN);
const hhmm = (d: Date) => d.toISOString().slice(11, 16).replace(":", "") + "Z";
const blobOf = (n: Notam) => `${String(n.e_field ?? "")}\n${String(n.text ?? "")}`.toUpperCase();
const eOf = (n: Notam) => String(n.e_field || n.text || "").toUpperCase();

const PROHIBIT = /\b(PROHIBITED|NOT AVBL|NOT AVAILABLE|U\/S|UNSERVICEABLE|CLSD|CLOSED|SUSPENDED|WITHDRAWN|NOT AUTH(?:ORI[SZ]ED)?|DO NOT USE|NOT USABLE|NOT TO BE USED|SHALL NOT|RESTRICTED TO)\b/;
const RWY_CLSD = /\bRWY\s*\d{2}[LCR]?(?:\/\d{2}[LCR]?)?\s+(?:CLSD|CLOSED)\b/;
const AD_CLSD = /\b(AD|AERODROME|AIRPORT)\s+(?:CLSD|CLOSED)\b/;
const ALL_MOVE = /\b(ALL\s+(TWY|TAXIWAYS|STANDS|APRONS?)|NO\s+TAXI\s+ROUTE|APRON\s+CLSD|APRON\s+CLOSED)\b/;

// --------------------------------------------------------------------------- //
// Schedule (item D / E) — schedule_active_at
// --------------------------------------------------------------------------- //
const WD: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MON: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
type TPt = number | "SR" | "SS";
interface Clause { wd: Set<number> | null; days: Set<string> | null; times: Array<[TPt, TPt]> }
export interface Schedule { clauses: Clause[]; exc: Clause | null; unsupported: string[]; always: boolean }

export function parseSchedule(raw: unknown): Schedule {
  let t = String(raw ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!t) return { clauses: [], exc: null, unsupported: [], always: true };
  t = t.replace(/\bDLY\b|\bDAILY\b/g, " ").replace(/\bH24\b/g, " 0000-2359 ").replace(/\bHJ\b/g, " SR-SS ").replace(/\bHN\b/g, " SS-SR ");
  let exc = "";
  const ei = t.search(/\bEXC\b/);
  if (ei >= 0) { exc = t.slice(ei + 3); t = t.slice(0, ei); }
  const unsupported: string[] = [];
  const parseClauses = (txt: string, needTimes: boolean): Clause[] => {
    const toks = txt.replace(/,/g, " ").replace(/\s*-\s*/g, "-").replace(/\s*\/\s*/g, "-").replace(/\bTO\b/g, "-").replace(/\s*-\s*/g, "-").split(" ").filter(Boolean);
    const out: Clause[] = [];
    let cur: Clause = { wd: null, days: null, times: [] };
    let month = 0;
    const flush = () => { if (cur.times.length || cur.wd || cur.days) out.push(cur); cur = { wd: null, days: null, times: [] }; };
    for (const tok of toks) {
      let m: RegExpExecArray | null;
      if ((m = /^(\d{4}|SR|SS)-(\d{4}|SR|SS)$/.exec(tok))) {
        const p = (s: string): TPt | null => s === "SR" || s === "SS" ? s : (+s.slice(0, 2) <= 24 && +s.slice(2) < 60 ? +s.slice(0, 2) * 60 + +s.slice(2) : null);
        const a = p(m[1]!), b = p(m[2]!);
        if (a === null || b === null) { unsupported.push(tok); continue; }
        cur.times.push([a, b]);
        continue;
      }
      if (cur.times.length) flush();
      if ((m = /^(MON|TUE|WED|THU|FRI|SAT|SUN)(?:-(MON|TUE|WED|THU|FRI|SAT|SUN))?$/.exec(tok))) {
        cur.wd ??= new Set();
        const a = WD[m[1]!]!, b = m[2] ? WD[m[2]]! : a;
        for (let i = a; ; i = (i + 1) % 7) { cur.wd.add(i); if (i === b) break; }
        continue;
      }
      if ((m = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/.exec(tok))) { month = MON[m[1]!]!; continue; }
      if ((m = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(tok))) {
        const a = +m[1]!, b = m[2] ? +m[2] : a;
        if (a < 1 || a > 31 || b < 1 || b > 31) { unsupported.push(tok); continue; }
        cur.days ??= new Set();
        for (let d = a; d <= (b >= a ? b : 31); d++) cur.days.add(`${month}:${d}`);
        if (b < a) for (let d = 1; d <= b; d++) cur.days.add(`${month ? (month % 12) + 1 : 0}:${d}`);
        continue;
      }
      if ((m = /^(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{1,2})$/.exec(tok))) {
        cur.days ??= new Set(); cur.days.add(`${MON[m[1]!]}:${+m[2]!}`); month = MON[m[1]!]!; continue;
      }
      unsupported.push(tok);
    }
    flush();
    if (needTimes) {
      // selectors with no time range of their own share the following clause's times
      for (let i = out.length - 2; i >= 0; i--) if (!out[i]!.times.length) out[i]!.times = out[i + 1]!.times;
      if (out.length && !out[out.length - 1]!.times.length) out[out.length - 1]!.times = [[0, 1440]];
    }
    return out;
  };
  const clauses = parseClauses(t, true);
  const excC = exc ? parseClauses(exc, false) : [];
  const excMerged: Clause | null = excC.length ? {
    wd: excC.reduce<Set<number> | null>((s, c) => c.wd ? new Set([...(s ?? []), ...c.wd]) : s, null),
    days: excC.reduce<Set<string> | null>((s, c) => c.days ? new Set([...(s ?? []), ...c.days]) : s, null),
    times: excC.flatMap((c) => c.times),
  } : null;
  return { clauses, exc: excMerged, unsupported, always: !clauses.length && !unsupported.length };
}

// NOAA approximation, minutes UTC of sunrise/sunset for the date at lat/lon.
function sunMinute(date: Date, lat: number, lon: number, rise: boolean): number | null {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const n = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  const g = (2 * Math.PI / 365) * (n - 1);
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const la = lat * Math.PI / 180;
  const cosH = (Math.cos(90.833 * Math.PI / 180) / (Math.cos(la) * Math.cos(decl))) - Math.tan(la) * Math.tan(decl);
  if (cosH < -1 || cosH > 1) return null;
  const ha = Math.acos(cosH) * 180 / Math.PI;
  const m = 720 - 4 * (lon + (rise ? ha : -ha)) - eqt;
  return ((Math.round(m) % 1440) + 1440) % 1440;
}

function dayMatch(c: Clause, d: Date): boolean {
  if (c.wd && !c.wd.has(d.getUTCDay())) return false;
  if (c.days) {
    const day = d.getUTCDate(), mo = d.getUTCMonth() + 1;
    if (!c.days.has(`${mo}:${day}`) && !c.days.has(`0:${day}`)) return false;
  }
  return true;
}

/** true = active at t, false = inactive, null = cannot be computed. */
export function scheduleActiveAt(s: Schedule, t: Date, pos: [number, number] | null): Tri {
  if (s.always) return true;
  if (s.unsupported.length) return null;
  const minute = t.getUTCHours() * 60 + t.getUTCMinutes();
  const resolve = (p: TPt, day: Date): number | null => typeof p === "number" ? p : (pos ? sunMinute(day, pos[0], pos[1], p === "SR") : null);
  const inRange = (c: Clause): Tri => {
    let unknown = false;
    for (const [a0, b0] of c.times) {
      // check range starting today and range started yesterday (overnight)
      for (const back of [0, 1]) {
        const day = new Date(t.getTime() - back * 86400000);
        if (!dayMatch(c, day)) continue;
        const a = resolve(a0, day), b = resolve(b0, day);
        if (a === null || b === null) { unknown = true; continue; }
        const span = b > a ? b - a : b + 1440 - a;
        const off = back * 1440 + minute - a;
        if (off >= 0 && off <= span && (back === 0 || b <= a)) return true;
      }
    }
    return unknown ? null : false;
  };
  let res: Tri = false;
  for (const c of s.clauses) {
    const r = inRange(c);
    if (r === true) { res = true; break; }
    if (r === null) res = null;
  }
  if (res === true && s.exc) {
    const e = s.exc;
    const dayHit = (e.wd || e.days) ? dayMatch(e, t) : true;
    if (dayHit && !e.times.length && (e.wd || e.days)) return false;
    if (dayHit && e.times.length) { const r = inRange({ ...e, wd: e.wd, days: e.days }); if (r === true) return false; if (r === null) return null; }
  }
  return res;
}

// --------------------------------------------------------------------------- //
// Operational windows (operational_windows.build_operational_windows)
// --------------------------------------------------------------------------- //
interface Win { kind: string; ref: string; start: Date | null; end: Date | null }

function roleWindow(role: Role, code: string, f: AssessFlight, c: AssessCfg): Win {
  const { etd, eta } = f;
  switch (role) {
    case "DEP": return { kind: "DEP", ref: code, start: etd && add(etd, -c.dep_before), end: etd && add(etd, c.dep_after) };
    case "ARR": return { kind: "ARR", ref: code, start: eta && add(eta, -c.arr_before), end: eta && add(eta, c.arr_after) };
    case "TALT": return { kind: "TALT", ref: code, start: etd && add(etd, -c.talt_before), end: etd && add(etd, c.talt_after) };
    // En-route alternate: diversion ETA unknown → earliest = ETD, latest = ETA.
    case "RALT": return { kind: "ENRT_ALT", ref: code, start: etd, end: eta && add(eta, c.enrt_alt_after) };
    case "ALT": return { kind: "DEST_ALT", ref: code, start: eta && add(eta, -c.dest_alt_before), end: eta && add(eta, c.dest_alt_after) };
  }
}

function selectWindow(code: string, qfir: string, f: AssessFlight, c: AssessCfg): Win | null {
  const role = f.roles[code];
  if (role) return roleWindow(role, code, f, c);
  const refs = [...new Set([code, qfir].filter((x) => x && f.firs[x]))];
  if (refs.length !== 1) return null;
  const [a, b] = f.firs[refs[0]!]!;
  return { kind: "FIR", ref: refs[0]!, start: add(a, -c.fir_before), end: add(b, c.fir_after) };
}

type Overlap = "ON_TIME" | "DELAY_ONLY" | "NO" | "UNRESOLVED";
function classifyOverlap(b: Date | null, cEnd: Date | null, w: Win, maxDelay: number): Overlap {
  if (!w.start || !w.end || !b) return "UNRESOLVED";
  const delayedEnd = add(w.end, maxDelay);
  const ce = cEnd ?? delayedEnd;
  if (b <= w.end && ce >= w.start) return "ON_TIME";
  if (b <= delayedEnd && ce > w.end) return "DELAY_ONLY";
  return "NO";
}

// --------------------------------------------------------------------------- //
// spatial_match — ordered branches, first match wins
// --------------------------------------------------------------------------- //
export interface Spatial {
  matched: Tri;
  type: string;
  reason: string;
  fl?: number | null;
  flRange?: [number, number] | null;
  at?: Date | null;
  expStart?: Date | null;
  expEnd?: Date | null;
  briefing?: boolean;
}

const AC_RFFS: Record<string, number> = { A21N: 7, A321: 7, A333: 9 };

function pointTime(f: AssessFlight, p: TrackPoint | undefined): Date | null {
  if (!p || !f.etd || !Number.isFinite(Number(p.ete_min))) return null;
  return add(f.etd, Number(p.ete_min));
}
const pointNames = (f: AssessFlight) => new Set(f.points.map((p) => String(p.name ?? "").toUpperCase()).filter(Boolean));
const onRoute = (f: AssessFlight, tok: string) => f.tokens.has(tok) || pointNames(f).has(tok);

function airportHit(code: string, f: AssessFlight, type: string, reason: string, briefing = false): Spatial {
  const role = f.roles[code];
  if (role === "DEP") return { matched: true, type, reason, fl: 0, at: f.etd, briefing };
  if (role === "ARR") return { matched: true, type, reason, fl: 0, at: f.eta, briefing };
  if (role === "TALT") return { matched: true, type, reason, fl: 0, expStart: f.etd, expEnd: f.etd && add(f.etd, 60), briefing };
  return { matched: true, type, reason, fl: 0, expStart: role === "ALT" ? f.eta : f.etd, expEnd: f.eta, briefing };
}

export function spatialMatch(n: Notam, code: string, kind: string, f: AssessFlight, cfg: AssessCfg): Spatial {
  const E = eOf(n), B = blobOf(n);
  const role = f.roles[code];
  const isAirport = kind !== "FIR" && !!role;
  const qfir = normIcao(String(n.qfir ?? ""));
  const scope = String(n.scope ?? "").toUpperCase();
  const prohibit = PROHIBIT.test(E);
  const no = (type: string, reason: string): Spatial => ({ matched: false, type, reason });
  const unk = (type: string, reason: string): Spatial => ({ matched: null, type, reason });
  const brief = (type: string, reason: string): Spatial => isAirport ? airportHit(code, f, type, reason, true) : { matched: true, type, reason, briefing: true };

  // 1 helicopter
  if (/\bHEL(?:I|ICOPTER)?\b|\bHELICOPTER/.test(E) && /\b(ROUTE|TRAINING|TRG|CORRIDOR)\b/.test(E) && /\b(SUSPENDED|CLSD|CLOSED)\b/.test(E))
    return no("HELICOPTER", "Đường/huấn luyện trực thăng bị đóng/tạm dừng — chuyến là tàu cánh bằng IFR.");
  // 2 VFR only
  if (/\bVFR\b/.test(E) && !/\bIFR\b/.test(E) && /\bVFR\s+(ACFT|AIRCRAFT|FLT|FLIGHTS?|TRAFFIC|ROUTE)/.test(E))
    return no("VFR-ONLY", "Item E chỉ áp dụng tàu VFR — chuyến bay IFR.");
  // 3 AIP SUP / AMDT trigger
  if (/TRIGGER\s+NOTAM/.test(E) || (/\bAIP\s+(SUP|AMDT|SUPPLEMENT)/.test(E) && /\b(VALIDITY|VALID|EXTENDED|REPLACED|REF)\b/.test(E)))
    return unk("AIP-SUP", "NOTAM trỏ AIP SUP/AMDT — cần đọc AIP SUP gốc.");
  // 4 minima change
  if (isAirport && /\b(MINIMA|MNM|OCA|OCH|MDA|DA\/H|RVR)\b/.test(E) && /\b(TKOF|TAKE-?OFF|LDG|LANDING|APCH|APPROACH)\b/.test(E))
    return unk("MINIMA", "Đổi minima cất/hạ cánh tại sân của chuyến — cần đối chiếu thời tiết/minima.");
  // 5-6 procedures
  const procs = procNames(E);
  const mentionsProc = procs.length > 0 || /\b(SID|STAR|IAP|INSTRUMENT APPROACH|RNP APCH|ILS APCH)\b/.test(E);
  if (mentionsProc && role) {
    if (role !== "DEP" && role !== "ARR") return unk("PROCEDURE-ALT", "Procedure tại sân dự bị — cần kiểm tra tay.");
    const planned = role === "DEP" ? f.sid : f.star;
    if (!planned) {
      if (procs.length && procs.some((p) => onRoute(f, p) || pointNames(f).has(stem(p))))
        return procWindow(n, procs.find((p) => onRoute(f, p) || pointNames(f).has(stem(p)))!, role, f, prohibit);
      if (/\b(SID|STAR)\b/.test(E) || procs.length) return unk("PROCEDURE-UNPARSED", "OFP chưa tách được SID/STAR mà NOTAM nói procedure của phase này.");
    } else {
      const hit = procs.filter((p) => p === planned || stem(p) === stem(planned));
      if (hit.length > 1) return unk("PROCEDURE-MULTI", `Trúng nhiều procedure (${hit.join(", ")}).`);
      if (hit.length === 1) return procWindow(n, planned, role, f, prohibit);
      if (role === "ARR" && /\b(IAP|APCH|APPROACH|ILS|RNP)\b/.test(E) && prohibit)
        return unk("APPROACH", "Cấm approach tại sân đến — không trúng STAR nhưng cần xem approach dự kiến.");
      if (procs.length) return no("PROCEDURE-OTHER", `Procedure ${procs.join(", ")} khác ${role === "DEP" ? "SID" : "STAR"} kế hoạch ${planned}.`);
    }
  }
  // 7 ATS route segment
  const seg = /(?:ATS\s+RTE\s+SEGMENT|SEGMENT|RTE)\s+([A-Z]{1,2}\d{1,4}[A-Z]?)\s*\(?\s*([A-Z]{5})\s*-\s*([A-Z]{5})/.exec(E)
    || /\b([A-Z]{1,2}\d{1,4}[A-Z]?)\s+(?:BTN|BETWEEN)\s+([A-Z]{3,5})\s+(?:AND|-)\s+([A-Z]{3,5})\b/.exec(E);
  if (seg) {
    const [, awy, a, b] = seg as unknown as [string, string, string, string];
    if (!f.tokens.size && !f.points.length) return unk("ROUTE-SEGMENT", `Không có route của chuyến để so đoạn ${awy} ${a}-${b}.`);
    const names = f.points.map((p) => String(p.name ?? "").toUpperCase());
    const ia = names.indexOf(a), ib = names.indexOf(b);
    if ((f.tokens.has(awy) || (ia >= 0 && ib >= 0)) && (ia >= 0 || ib >= 0)) {
      const i0 = ia >= 0 && ib >= 0 ? Math.min(ia, ib) : Math.max(ia, ib);
      const i1 = ia >= 0 && ib >= 0 ? Math.max(ia, ib) : i0;
      const fls = f.points.slice(i0, i1 + 1).map((p) => Math.round(Number(p.fl_ft || 0) / 100));
      return { matched: true, type: "ROUTE-SEGMENT", reason: `Đoạn ${awy} ${a}-${b} trùng route FPL.`, flRange: [Math.min(...fls), Math.max(...fls)], expStart: pointTime(f, f.points[i0]), expEnd: pointTime(f, f.points[i1]) };
    }
    if (!f.tokens.has(awy) && (ia >= 0 || ib >= 0)) return unk("ROUTE-SEGMENT", `Có điểm ${ia >= 0 ? a : b} trên route nhưng chưa xác nhận đường ${awy}.`);
    return no("ROUTE-SEGMENT", `Đoạn ${awy} ${a}-${b} không nằm trên route FPL.`);
  }
  // 8 advisory route
  const adr = /ADVISORY\s+ROUTE\s+([A-Z]{1,2}\d{1,4})/.exec(E);
  if (adr && (f.tokens.size || f.points.length) && !onRoute(f, adr[1]!))
    return no("ADVISORY-ROUTE", `Advisory route ${adr[1]} không phải đường đang bay.`);
  // 9 navaid in quotes
  const nav = [...E.matchAll(/'([A-Z]{2,3})'/g)].map((m) => m[1]!);
  if (nav.length && /\b(VOR|DME|NDB|TACAN|VORTAC|LOC|GP)\b/.test(E)) {
    const hitNav = nav.find((x) => onRoute(f, x));
    if (!hitNav) return no("NAVAID", `Navaid ${nav.join(", ")} không có trên FPL/navlog.`);
    const ix = f.points.findIndex((p) => String(p.name ?? "").toUpperCase() === hitNav);
    const p = f.points[ix];
    return { matched: true, type: "NAVAID", reason: `Navaid ${hitNav} có trên route.`, fl: p ? Math.round(Number(p.fl_ft || 0) / 100) : null, at: pointTime(f, p) };
  }
  // 10 Jeppesen chart notice
  if (/\bJEPPESEN\b|\bCHART\s+(CHANGE|NOTICE)/.test(E)) {
    const tok = [...E.matchAll(/\b([A-Z]{1,2}\d{1,4}|[A-Z]{5})\b/g)].map((m) => m[1]!).find((t) => onRoute(f, t));
    if (tok && prohibit) return unk("CHART-ROUTE-RESTRICTION", `Chart notice có hạn chế trên ${tok} của route.`);
    return { matched: true, type: "CHART-ROUTE-RESTRICTION", reason: "Jeppesen chart notice — thông tin briefing.", briefing: true };
  }
  // 11 RFFS
  const rffs = /\b(RFFS|FIRE\s*FIGHTING|RESCUE AND FIRE)\b/.test(E) ? /\bCAT(?:EGORY)?\s*(\d{1,2})\b/.exec(E) : null;
  if (rffs) {
    if (!role) return no("RFFS", "Hạ cấp RFFS tại sân không thuộc chuyến.");
    const need = AC_RFFS[f.acType.toUpperCase()];
    if (!need) return unk("RFFS", `Chưa có hạng RFFS cho loại tàu ${f.acType || "?"}.`);
    const cat = +rffs[1]!;
    if (cat >= need) return brief("BRIEFING-INFO", `RFFS còn CAT ${cat} ≥ CAT ${need} của ${f.acType}.`);
    return airportHit(code, f, "RFFS", `RFFS còn CAT ${cat} < CAT ${need} của ${f.acType}.`);
  }
  // 12 ILS / GNSS at airport
  if (kind !== "FIR" && (/\bILS\b.*\b(U\/S|DOWNGRADED|NOT AVBL|UNSERVICEABLE)\b/.test(E) || /\b(GNSS|GPS)\b.*\b(UNRELIABLE|U\/S|NOT AVBL|OUTAGE|INTERFERENCE|JAMMING)\b/.test(E))) {
    return role ? unk("NAV-AID-AD", "ILS/GNSS xuống cấp tại sân của chuyến — cần kiểm tra approach.") : no("NAV-AID-AD", "ILS/GNSS tại sân khác.");
  }
  // 13 admin content
  if (/\b(CHARGES?|FEES?|TEL\b|PHONE|NIL AIRAC|E-?MAIL)\b/.test(E) && !prohibit)
    return no("ADMIN", "Nội dung phí/điện thoại/chart metadata/NIL AIRAC.");
  // 14 ADS-B / GNSS / FIR frequency
  if (kind === "FIR" && /\b(ADS-B|ADSB|GNSS|GPS|FREQ|FREQUENCY|VHF|HF|CPDLC)\b/.test(E) && /\b(U\/S|OUTAGE|NOT AVBL|UNRELIABLE|INTERFERENCE)\b/.test(E)) {
    const fir = qfir || code;
    return f.firs[fir] ? { matched: true, type: "BRIEFING-INFO", reason: `${fir} nằm trên route — thông tin liên lạc/dẫn đường.`, briefing: true } : no("FIR-COM", `${fir} không nằm trên route.`);
  }
  // 15 radio check
  if (/\bRADIO\s+CHECK\b/.test(E) && !/\b(U\/S|OUTAGE|CLSD|CLOSED)\b/.test(E))
    return role ? brief("BRIEFING-INFO", "Radio check tại sân của chuyến.") : no("RADIO-CHECK", "Radio check tại sân khác.");
  // 16 airport briefing patterns
  if (isAirport && /\b(BIRD|BIRDS|WIP|WORK IN PROGRESS|WORKS|ATIS|FRICTION|LGT|LIGHTS?|LIGHTING|PAPI|APAPI|CRANE OPS|GRASS CUTTING)\b/.test(E)
      && !RWY_CLSD.test(E) && !AD_CLSD.test(E) && !ALL_MOVE.test(E) && !(role === "ALT" || role === "RALT" ? prohibit && /WIP|WORK/.test(E) : false)
      && !/\b(OBST|OBSTACLE|CRANE)\b/.test(E))
    return brief("BRIEFING-INFO", "Chim/WIP/đèn/ATIS/friction không đóng đường băng — briefing.");
  // 17 stand / apron / taxiway
  if (isAirport && /\b(TWY|TAXIWAY|TAXILANE|TXL|STAND|STANDS|APRON|ACFT STANDS)\b/.test(E)) {
    if (ALL_MOVE.test(E) || AD_CLSD.test(E))
      return airportHit(code, f, "AIRPORT-MOVEMENT", "Đóng toàn bộ taxiway/apron/đường lăn — ảnh hưởng di chuyển trên sân.");
    if (!RWY_CLSD.test(E)) return brief("BRIEFING-INFO", "Đóng một phần stand/apron/taxiway, sân còn đường khác — briefing.");
  }
  // 18-22 geometry
  const isObst = /\b(OBST|OBSTACLE|CRANE|MAST|TOWER|POLE|CHIMNEY|ANTENNA|WIND TURBINE)\b/.test(E);
  const isUa = /\b(UA|UAS|UAV|RPAS|DRONE|DRONES|PJE|PARACHUT\w*|BALLOON|KITE)\b/.test(E);
  const q = qCoordsOf(n);
  const qRadius = q && q[2] > 0 && q[2] < 500 ? q[2] : 0;
  const geoms = notamGeoms(n).filter((g) => !(g.shape === "circle" && (g.radius_nm || 0) >= 500));
  const areaGeoms = geoms.filter((g) => g.shape !== "dot");
  if (areaGeoms.length || (q && qRadius && !(scope === "A" && !role))) {
    if (!f.points.length) return unk("GEOMETRY", "Chưa có điểm route (track) để đo khoảng cách tới vùng NOTAM.");
    const list = areaGeoms.length ? areaGeoms : [{ name: "Q", shape: "circle" as const, lat: q![0], lon: q![1], radius_nm: qRadius, ring: [] }];
    let best: { d: number; idx: number } | null = null;
    for (const g of list) {
      const near = geomTrackNear(g, f.points);
      if (near.dist_nm === null) continue;
      if (!best || near.dist_nm < best.d) best = { d: near.dist_nm, idx: near.idx };
    }
    if (!best) return unk("GEOMETRY", "Không đo được khoảng cách tới vùng NOTAM.");
    const p = f.points[best.idx];
    const src = areaGeoms.length ? "hình trong NOTAM" : `Q-line bán kính ${qRadius} NM`;
    if (best.d <= cfg.corridor_nm) {
      const base = { fl: p ? Math.round(Number(p.fl_ft || 0) / 100) : null, at: pointTime(f, p) };
      if ((isUa || isObst) && !prohibit)
        return { matched: true, type: isObst ? "OBSTACLE-BRIEFING" : "BRIEFING-INFO", reason: `${isObst ? "Chướng ngại" : "UA/UAV"} trong hành lang ${cfg.corridor_nm} NM, không có chữ cấm.`, briefing: true, ...base };
      return { matched: true, type: "GEOMETRY", reason: `Route cách ${src} ${best.d.toFixed(1)} NM ≤ ${cfg.corridor_nm} NM (gần ${p?.name || "điểm"}).`, ...base };
    }
    const routeTok = [...E.matchAll(/\b([A-Z]{1,2}\d{1,4}|[A-Z]{5})\b/g)].map((m) => m[1]!).find((t) => onRoute(f, t));
    if (prohibit && routeTok) return unk("GEOMETRY", `Hình cách route ${best.d.toFixed(1)} NM nhưng item E cấm và nhắc ${routeTok} trên FPL.`);
    return no("GEOMETRY", `Route cách ${src} ${best.d.toFixed(1)} NM > bán kính + ${cfg.corridor_nm} NM.`);
  }
  // 20 obstacle/firework at our airport without position
  if (isAirport && (isObst || /\bFIREWORKS?\b/.test(E)) && !/\d+\s*FT/.test(E))
    return unk("OBSTACLE", "Chướng ngại/pháo hoa tại sân của chuyến nhưng thiếu toạ độ/chiều cao.");
  // 21 scope A at alternates
  if ((role === "RALT" || role === "ALT") && !AD_CLSD.test(E))
    return unk("ALTERNATE", "NOTAM tại sân dự bị, không đóng cả sân — cần kiểm tra tay.");
  // 23 scope A, centre, not our airport
  if (scope === "A" && q && !role) return no("AIRPORT-OTHER", "NOTAM sân không thuộc chuyến.");
  // 24 DEP/ARR/alternate match
  if (role === "DEP" || role === "ARR" || role === "TALT") return airportHit(code, f, "AIRPORT", `NOTAM tại sân ${role} ${code}.`);
  if (role) return airportHit(code, f, "AIRPORT", `Đóng sân dự bị ${code}.`);
  // 25 named area without boundary
  if (/\b(DANGER|RESTRICTED|PROHIBITED|TRA|TSA)\b|\b(?:[A-Z]{2})?[DRP]\s?\d{1,4}[A-Z]?\b/.test(E) && /\b(AREA|ZONE|ACT|ACTIVE)\b/.test(E))
    return unk("NAMED-AIRSPACE", "Vùng có tên chưa có ranh giới trong catalog — không lấy tâm Q-line làm cả vùng.");
  // 26-27 centre only
  if (q) {
    if (!f.points.length) return unk("CENTRE-ONLY", "Chỉ có tâm Q-line, chưa có route để đo.");
    const near = geomTrackNear({ name: "Q", shape: "dot", lat: q[0], lon: q[1], radius_nm: 0, ring: [] }, f.points);
    if (isUa && near.dist_nm !== null && near.dist_nm <= cfg.corridor_nm) {
      const p = f.points[near.idx];
      return { matched: true, type: prohibit ? "UA-CENTRE" : "BRIEFING-INFO", reason: `Tâm UA/PJE cách route ${near.dist_nm.toFixed(1)} NM.`, fl: p ? Math.round(Number(p.fl_ft || 0) / 100) : null, at: pointTime(f, p), briefing: !prohibit };
    }
    return unk("CENTRE-ONLY", "Q-line chỉ có tâm, không có bán kính/vùng — cần kiểm tra tay.");
  }
  // 28
  if ((qfir && f.firs[qfir]) || f.firs[code]) return unk("FIR-ONLY", `NOTAM thuộc FIR ${qfir || code} của chuyến, không có toạ độ/đoạn route.`);
  return no("NO-GEOMETRY", "Không trùng sân, không có hình, không thuộc FIR của chuyến.");
}

function stem(p: string): string { return (/^([A-Z]{2,5})/.exec(p) || [, p])[1]!; }
function procNames(E: string): string[] {
  const out = new Set<string>();
  for (const m of E.matchAll(/\b([A-Z]{3,5}\d[A-Z])\b/g)) if (!/^(RWY|TWY|FL|ACFT)/.test(m[1]!)) out.add(m[1]!);
  return [...out];
}
function procWindow(_n: Notam, proc: string, role: Role, f: AssessFlight, prohibit: boolean): Spatial {
  const fix = f.points.findIndex((p) => String(p.name ?? "").toUpperCase() === stem(proc));
  const p = fix >= 0 ? f.points[fix] : undefined;
  if (!p) return { matched: null, type: "SID-STAR", reason: `${proc} đúng FPL nhưng thiếu fix ${role === "DEP" ? "thoát SID" : "vào STAR"}.` };
  const t = pointTime(f, p);
  const fl = Math.round(Number(p.fl_ft || 0) / 100);
  const exp = role === "DEP" ? { expStart: f.etd, expEnd: t } : { expStart: t, expEnd: f.eta };
  if (!prohibit) return { matched: true, type: "BRIEFING-INFO", reason: `Nhắc ${proc} đúng FPL, không có chữ cấm.`, briefing: true, flRange: role === "DEP" ? [0, fl] : [0, fl], ...exp };
  return { matched: true, type: role === "DEP" ? "SID" : "STAR", reason: `Hạn chế ${proc} đúng ${role === "DEP" ? "SID" : "STAR"} trên FPL.`, flRange: [0, fl], ...exp };
}

// --------------------------------------------------------------------------- //
// Altitude
// --------------------------------------------------------------------------- //
function notamBand(n: Notam): [number, number] | null {
  const E = eOf(n);
  if (/\b(OBST|OBSTACLE|CRANE|MAST|TOWER|POLE)\b/.test(E)) {
    const ft = [...E.matchAll(/(\d{2,5})\s*FT\s*(?:AMSL|MSL)/g)].map((m) => +m[1]!);
    if (ft.length) return [0, Math.ceil(Math.max(...ft) / 100)];
  }
  const has = [n.f_field, n.g_field, n.lower, n.upper].some((v) => v !== undefined && v !== null && String(v).trim() !== "");
  if (!has) return null;
  const [lo, hi] = notamAltBand(n);
  return [Math.floor(lo / 100), Math.ceil(hi / 100)];
}

// --------------------------------------------------------------------------- //
// _assess_one
// --------------------------------------------------------------------------- //
export function assessNotam(n: Notam, code: string, kind: string, f: AssessFlight, cfg: AssessCfg): Assessment {
  const reasons: string[] = [];
  const out = (level: Level, match_type: string, delay: number | null = null): Assessment => ({ level, earliest_impact_delay_minutes: delay, match_type, reasons });
  const maxD = cfg.max_delay_minutes;

  // 0 parse errors
  const missing: string[] = [];
  if (!String(n.e_field || n.text || "").trim()) missing.push("E");
  if (!String(n.start ?? "").trim()) missing.push("B");
  if (!String(n.end ?? "").trim()) missing.push("C");
  const b = parseNotamWhen(n.start);
  const perm = /PERM/i.test(String(n.end ?? ""));
  const c = perm ? null : parseNotamWhen(n.end, true);
  if (String(n.start ?? "").trim() && !b) missing.push("B");
  if (String(n.end ?? "").trim() && !perm && !c) missing.push("C");
  if (missing.length) { reasons.push(`Thiếu/không đọc được mục ${[...new Set(missing)].join("/")} — cần kiểm tra tay.`); return out("NEED MANUAL CHECK", "PARSE-ERROR"); }

  const qfir = normIcao(String(n.qfir ?? ""));
  const sp = spatialMatch(n, code, kind, f, cfg);
  const pos: [number, number] | null = (() => { const q = qCoordsOf(n); return q ? [q[0], q[1]] : null; })();

  // 1 role window
  const w = selectWindow(code, qfir, f, cfg);
  if (w) {
    const ov = classifyOverlap(b, c, w, maxD);
    if (ov === "NO") { reasons.push(`B–C ngoài cửa sổ ${w.kind} ${w.ref} (${w.start ? hhmm(w.start) : "?"}–${w.end ? hhmm(w.end) : "?"} + trễ ${maxD}′).`); return out("NO IMPACT", sp.type); }
    if (ov === "UNRESOLVED" && sp.matched !== false && sp.type !== "BRIEFING-INFO" && sp.type !== "CHART-ROUTE-RESTRICTION") {
      reasons.push(`Thiếu giờ cửa sổ ${w.kind} ${w.ref}.`); return out("NEED MANUAL CHECK", sp.type);
    }
    if (ov === "ON_TIME") reasons.push(`Giờ hiệu lực giao cửa sổ ${w.kind} ${w.ref} đúng giờ.`);
    if (ov === "DELAY_ONLY") reasons.push(`Giờ hiệu lực chỉ giao cửa sổ ${w.kind} ${w.ref} khi trễ.`);
  }

  // 2 whole flight window + schedule
  const sched = parseSchedule(n.d_field);
  if (f.etd && f.eta) {
    const ws = f.etd, we = add(f.eta, maxD + Math.max(cfg.dest_alt_after, cfg.enrt_alt_after));
    const s0 = b && b > ws ? b : ws, e0 = c && c < we ? c : we;
    if (s0 > e0) { reasons.push("B–C không giao thời gian cả chuyến (cộng trễ tối đa)."); return out("NO IMPACT", sp.type); }
    if (!sched.always) {
      let alive = false, unknown = false;
      for (let t = s0.getTime(); t <= e0.getTime(); t += MIN) {
        const r = scheduleActiveAt(sched, new Date(t), pos);
        if (r === true) { alive = true; break; }
        if (r === null) unknown = true;
      }
      if (!alive && !unknown) { reasons.push(`Lịch D) "${String(n.d_field)}" không bật trong thời gian chuyến.`); return out("NO IMPACT", sp.type); }
    }
  }

  // 3 spatial
  reasons.push(sp.reason);
  if (sp.matched === false) return out("NO IMPACT", sp.type);
  if (sp.matched === null) return out("NEED MANUAL CHECK", sp.type);
  if (sched.unsupported.length) { reasons.push(`Lịch D) có phần chưa hiểu: ${sched.unsupported.join(" ")}.`); return out("NEED MANUAL CHECK", sp.type); }

  // 4 altitude
  if (sp.type !== "BRIEFING-INFO" && sp.type !== "CHART-ROUTE-RESTRICTION") {
    const band = notamBand(n);
    const fr = sp.flRange ?? (sp.fl !== undefined && sp.fl !== null ? [sp.fl, sp.fl] as [number, number] : null);
    if (!band || !fr) { reasons.push("Thiếu cao độ NOTAM hoặc FL của chuyến tại điểm giao."); return out("NEED MANUAL CHECK", sp.type); }
    if (!(band[0] <= fr[1] && fr[0] <= band[1])) {
      reasons.push(`FL kế hoạch ${fr[0]}${fr[1] !== fr[0] ? "–" + fr[1] : ""} ngoài dải NOTAM FL${band[0]}–FL${band[1]}.`);
      if (sp.type === "ROUTE-SEGMENT") return out("BRIEFING INFO", sp.type);
      return out("NO IMPACT", sp.type);
    }
    reasons.push(`FL ${fr[0]}${fr[1] !== fr[0] ? "–" + fr[1] : ""} nằm trong dải FL${band[0]}–FL${band[1]}.`);
  }

  // 5 earliest delay
  const active = (t: Date): Tri => {
    if (b && t < b) return false;
    if (c && t > c) return false;
    return scheduleActiveAt(sched, t, pos);
  };
  let es = sp.expStart ?? null, ee = sp.expEnd ?? null;
  const at = sp.at ?? null;
  if (!at && !(es && ee)) { es = f.etd; ee = f.eta; }
  if (!at && !(es && ee)) {
    if (sp.briefing) return out("BRIEFING INFO", sp.type);
    reasons.push("Thiếu giờ phơi nhiễm (ETD/ETA/giờ qua điểm)."); return out("NEED MANUAL CHECK", sp.type);
  }
  let unknown = false;
  for (let d = 0; d <= maxD; d++) {
    let r: Tri = false;
    if (at) r = active(add(at, d));
    else {
      const s = add(es!, d).getTime(), e = add(ee!, d).getTime();
      for (let t = s; t <= Math.max(s, e); t += MIN) {
        const x = active(new Date(t));
        if (x === true) { r = true; break; }
        if (x === null) r = null;
      }
    }
    if (r === true) {
      if (sp.briefing) return out("BRIEFING INFO", sp.type, d);
      if (d === 0) { reasons.push("Có hiệu lực đúng giờ kế hoạch."); return out("CRITICAL", sp.type, 0); }
      reasons.push(`Chỉ ảnh hưởng nếu trễ từ ${d} phút.`); return out("DELAY-ONLY", sp.type, d);
    }
    if (r === null) unknown = true;
  }
  if (unknown) { reasons.push("Có phút không tính được lịch hoạt động."); return out("NEED MANUAL CHECK", sp.type); }
  reasons.push(`Không có phút nào giao giờ phơi nhiễm (kể cả trễ ${maxD}′).`);
  return out("NO IMPACT", sp.type);
}
