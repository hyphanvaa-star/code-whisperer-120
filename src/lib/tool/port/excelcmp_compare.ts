// Port of excelcmp/compare.py — compares an uploaded Excel sheet with FliteBrief flights.
import type { Flight, Crew } from "../core/models";
import { type Sheet, sheetDicts } from "./excelcmp_reader";
import WORLD_TZ from "../data/world_tz.json";

export interface FieldDef {
  key: string;
  label: string;
  aliases: string[];
  getter: (f: Flight) => unknown;
  kind: "text" | "number" | "time" | "date" | "airport" | "actype" | "crew";
}

export const FIELDS: FieldDef[] = [
  { key: "callsign", label: "Callsign", aliases: ["callsign", "call sign", "flight", "flightno", "flight no", "flt", "fltno", "flight number", "so hieu", "chuyen bay"], getter: (f) => f.callsign, kind: "text" },
  { key: "date", label: "Ngày", aliases: ["date", "day", "ngay", "flight date", "std date", "dep date"], getter: (f) => (f.std ? dateOnly(f.std) : null), kind: "date" },
  { key: "std", label: "STD", aliases: ["std", "dep time", "departure", "gio di", "off block", "scheduled", "sched"], getter: (f) => f.std, kind: "time" },
  { key: "etd", label: "ETD", aliases: ["etd", "revised etd", "new etd", "estimated dep", "gio etd"], getter: (f) => f.etd, kind: "time" },
  { key: "sta", label: "STA", aliases: ["sta", "eta", "arr time", "arrival", "gio den"], getter: (f) => f.sta, kind: "time" },
  { key: "dep", label: "Sân bay đi", aliases: ["dep", "from", "origin", "dep icao", "dep iata", "departure airport", "san bay di"], getter: (f) => [f.dep_icao, f.dep_iata], kind: "airport" },
  { key: "dest", label: "Sân bay đến", aliases: ["dest", "to", "destination", "arr", "dest icao", "dest iata", "san bay den"], getter: (f) => [f.dest_icao, f.dest_iata], kind: "airport" },
  { key: "reg", label: "Reg", aliases: ["reg", "registration", "tail", "so dang ky"], getter: (f) => f.reg, kind: "text" },
  { key: "ac_type", label: "Loại tàu", aliases: ["ac", "acft", "ac type", "actype", "aircraft", "aircraft type", "loai tau"], getter: (f) => f.ac_type || f.acft_type, kind: "actype" },
  { key: "dispatcher", label: "Dispatcher", aliases: ["dispatcher", "dsp", "nguoi lam", "planner"], getter: (f) => f.dispatcher, kind: "text" },
  { key: "block_fuel", label: "Block fuel", aliases: ["block fuel", "blockfuel", "block", "total fuel", "fuel", "tof", "takeoff fuel", "planned fuel"], getter: (f) => f.planned_fuel_total || f.planned_fuel, kind: "number" },
  { key: "taxi_fuel", label: "Taxi fuel", aliases: ["taxi", "taxi fuel"], getter: (f) => f.planned_taxi_fuel, kind: "number" },
  { key: "reserve_fuel", label: "Reserve", aliases: ["reserve", "rsv", "final reserve"], getter: (f) => f.planned_reserve_fuel, kind: "number" },
  { key: "alt_fuel", label: "Alt fuel", aliases: ["alt fuel", "alternate fuel"], getter: (f) => f.planned_alt_fuel, kind: "number" },
  { key: "cont_fuel", label: "Cont fuel", aliases: ["cont", "contingency", "cont fuel"], getter: (f) => f.planned_con_fuel, kind: "number" },
  { key: "extra_fuel", label: "Extra fuel", aliases: ["extra", "extra fuel", "discretionary"], getter: (f) => f.planned_extra_fuel, kind: "number" },
  { key: "tow", label: "TOW", aliases: ["tow", "takeoff weight", "tkof weight"], getter: (f) => f.planned_takeoff_weight, kind: "number" },
  { key: "lw", label: "LW", aliases: ["lw", "landing weight", "ldw"], getter: (f) => f.landing_weight, kind: "number" },
  { key: "pax", label: "PAX", aliases: ["pax", "passenger", "so khach"], getter: (f) => f.pax_total || null, kind: "number" },
  { key: "alt1", label: "Alternate", aliases: ["alt1", "alt", "alternate", "altn", "alternate 1", "du bi"], getter: (f) => f.dest_alt1, kind: "text" },
  { key: "cfp_no", label: "CFP NO", aliases: ["cfp no", "cfpno", "cfp", "plan no", "planno", "ofp no", "plan number", "so cfp"], getter: (f) => f.plan_no, kind: "text" },
  { key: "crew_count", label: "Số crew", aliases: ["crew no", "crew count", "so crew", "sl crew", "crew qty"], getter: (f) => f.crew_count || null, kind: "number" },
  { key: "crew", label: "Crew", aliases: ["crew", "captain", "cpt", "pic", "commander", "to bay", "tobay", "crew name", "phi cong"], getter: (f) => f.crews.map((c) => c.full_name).join("; "), kind: "crew" },
];
export const BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

export const TABLE_COLUMNS: Array<[string, string]> = [
  ["callsign", "CALLSIGN"], ["route", "ROUTE"], ["std", "NGÀY GIỜ"], ["crew", "CREW"],
  ["reg", "REG"], ["dispatcher", "DSP"], ["alt1", "ALT"], ["cfp_no", "CFP NO"], ["block_fuel", "FUEL"],
];
export const TABLE_FIELDS = ["crew", "reg"];

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------- normalisation ----------------
const NON_ALNUM = /[^a-z0-9]+/g;
function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/#/g, " no ").replace(NON_ALNUM, " ").trim();
}

const NEO: Record<string, string> = { A21N: "321", A20N: "320", A19N: "319", A339: "330", A338: "330", A33N: "330", B38M: "737", B39M: "737" };
export function normActype(v: unknown): string {
  if (v == null) return "";
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (NEO[s]) return NEO[s];
  const m = /^[A-Z]?(\d{3})$/.exec(s);
  return m ? m[1]! : s;
}

export function normText(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim().toUpperCase();
  return s.toLowerCase().replace(NON_ALNUM, "").toUpperCase();
}

export function normNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim();
  s = s.replace(/\b(kg|kgs|lb|lbs|t|tons?)\b/gi, "");
  s = s.replace(/\s/g, "");
  if (s.includes(",") && !s.includes(".")) {
    const i = s.lastIndexOf(",");
    const head = s.slice(0, i);
    const tail = s.slice(i + 1);
    s = tail.length <= 2 && head ? `${head}.${tail}` : s.replace(/,/g, "");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) && s !== "" ? n : null;
}

export function nameTokens(v: unknown): Set<string> {
  if (v == null) return new Set();
  return new Set(String(v).toUpperCase().split(/[^A-Za-z0-9]+/).filter((t) => t.length > 1));
}

const CREW_PAIR = /\(([^)]*)\)\s*-?\s*(\d{3,6})/g;
const STAFF_AFTER_PAREN = /\)\s*-?\s*(\d{3,6})/g;
const STAFF_ANY = /\b(\d{3,6})\b/g;

export function crewEntries(raw: unknown): Array<[string, string]> {
  if (raw == null) return [];
  const s = String(raw);
  const out: Array<[string, string]> = [];
  let m: RegExpExecArray | null;
  CREW_PAIR.lastIndex = 0;
  while ((m = CREW_PAIR.exec(s))) out.push([(m[1] ?? "").trim(), m[2]!]);
  return out;
}

export function staffIds(raw: unknown, skipDhd = true): Set<string> {
  if (raw == null) return new Set();
  const pairs = crewEntries(raw);
  if (pairs.length) {
    return new Set(pairs.filter(([f]) => !(skipDhd && f.toUpperCase().includes("DHD"))).map(([, i]) => i.replace(/^0+/, "")));
  }
  const text = String(raw);
  const afterParen = new Set<string>();
  let m: RegExpExecArray | null;
  STAFF_AFTER_PAREN.lastIndex = 0;
  while ((m = STAFF_AFTER_PAREN.exec(text))) afterParen.add(m[1]!.replace(/^0+/, ""));
  if (afterParen.size) return afterParen;
  const any = new Set<string>();
  STAFF_ANY.lastIndex = 0;
  while ((m = STAFF_ANY.exec(text))) any.add(m[1]!.replace(/^0+/, ""));
  return any;
}

export function dhdIds(raw: unknown): Set<string> {
  return new Set(crewEntries(raw).filter(([f]) => f.toUpperCase().includes("DHD")).map(([, i]) => i.replace(/^0+/, "")));
}

export function crewId(username: string): string {
  const m = /(\d+)\s*$/.exec(String(username || ""));
  return m ? m[1]!.replace(/^0+/, "") : "";
}

export function crewVerdict(raw: unknown, flightCrews: Crew[]): [number, string] {
  const ex = staffIds(raw);
  const boEx = dhdIds(raw);
  const fb = new Set<string>();
  const boFb = new Set<string>();
  for (const c of flightCrews) {
    const i = crewId(c.username);
    if (!i) continue;
    (c.deadheading ? boFb : fb).add(i);
  }
  let ghiChu = "";
  if (boEx.size || boFb.size) {
    const ai = [...new Set([...boEx, ...boFb])].sort();
    ghiChu = ` · bỏ ${ai.length} DHD: ${ai.join(", ")}`;
  }
  if (!ex.size && !fb.size) return [0, "hai bên đều chưa có tổ bay" + ghiChu];
  if (!ex.size) {
    if (boEx.size && !fb.size) return [0, `Excel chỉ có ${boEx.size} người DHD, bỏ hết${ghiChu}`];
    const toks = nameTokens(raw);
    if ([...toks].some((t) => t.length >= 3)) {
      const real = new Set<string>();
      for (const c of flightCrews) {
        nameTokens(c.full_name).forEach((t) => real.add(t));
        nameTokens(c.username).forEach((t) => real.add(t));
      }
      const subset = [...toks].every((t) => real.has(t));
      return subset ? [0, "khớp theo tên" + ghiChu] : [1, "tên không khớp" + ghiChu];
    }
    return [fb.size, `Excel không ghi ai, FliteBrief có ${fb.size} người${ghiChu}`];
  }
  const missing = [...ex].filter((i) => !fb.has(i));
  let extra = [...fb].filter((i) => !ex.has(i));
  const lamViec = extra.filter((i) => boEx.has(i));
  extra = extra.filter((i) => !lamViec.includes(i));
  const n = Math.max(missing.length, extra.length) + lamViec.length;
  if (n === 0) return [0, `khớp cả ${ex.size} mã: ${[...ex].sort().join(", ")}${ghiChu}`];
  const parts: string[] = [];
  if (missing.length) parts.push("Excel có mà FliteBrief không: " + missing.sort().join(", "));
  if (extra.length) parts.push("FliteBrief có mà Excel không: " + extra.sort().join(", "));
  if (lamViec.length) parts.push("Excel ghi DHD nhưng FliteBrief xếp làm tổ bay: " + lamViec.sort().join(", "));
  return [n, parts.join(" · ") + ghiChu];
}

export function callsignKeys(value: unknown): Set<string> {
  const full = normText(value);
  if (!full) return new Set();
  const keys = new Set([full]);
  const digits = full.replace(/\D/g, "");
  if (digits) keys.add(digits);
  return keys;
}

export function sheetCallsigns(sheet: Sheet, mapping: Record<string, string>): Set<string> {
  const col = mapping["callsign"];
  if (!col) return new Set();
  const out = new Set<string>();
  for (const row of sheetDicts(sheet)) {
    callsignKeys(row[col]).forEach((k) => out.add(k));
  }
  return out;
}

const DATE_FORMATS: Array<(s: string) => Date | null> = [
  (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : null),
  (s) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    return m ? new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!)) : null;
  },
  (s) => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(s);
    return m ? new Date(Date.UTC(2000 + +m[3]!, +m[2]! - 1, +m[1]!)) : null;
  },
  (s) => {
    const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s);
    return m ? new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!)) : null;
  },
  (s) => {
    const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s);
    return m ? new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)) : null;
  },
  (s) => {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
    return m ? new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!)) : null;
  },
  (s) => (/^\d{8}$/.test(s) ? new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))) : null),
];

/** Returns a UTC midnight Date representing just the calendar date, or null. */
export function normDate(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate()));
  if (typeof v === "number") {
    try {
      const d = new Date((v - 25569) * 86400 * 1000);
      if (!Number.isFinite(d.getTime())) return null;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    } catch {
      return null;
    }
  }
  const s = String(v).trim();
  for (const fmt of DATE_FORMATS) {
    const d = fmt(s);
    if (d) return d;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) {
    const d = new Date(`${m[1]}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** Returns {h, m} or null — time-of-day only, no date. */
export function normTime(v: unknown): { h: number; m: number } | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return { h: v.getUTCHours(), m: v.getUTCMinutes() };
  if (typeof v === "number") {
    const f = v;
    const frac = f - Math.trunc(f);
    if (frac >= 0 && frac < 1 && f < 10) {
      const mins = Math.round(frac * 24 * 60);
      return { h: Math.floor(mins / 60) % 24, m: mins % 60 };
    }
    const n = Math.trunc(f);
    if (n >= 0 && n <= 2359) return n % 100 < 60 ? { h: Math.floor(n / 100) % 24, m: n % 100 } : null;
    return null;
  }
  let s = String(v).trim().toUpperCase().replace(/Z/g, "");
  let m = /^(\d{1,2})[:hH.](\d{2})/.exec(s);
  if (m) {
    const h = +m[1]!, mi = +m[2]!;
    return mi < 60 ? { h: h % 24, m: mi } : null;
  }
  if (/^\d{3,4}$/.test(s)) {
    const h = +s.slice(0, -2), mi = +s.slice(-2);
    return mi < 60 ? { h: h % 24, m: mi } : null;
  }
  return null;
}

function fmtTime(t: { h: number; m: number } | null): string {
  return t ? `${String(t.h).padStart(2, "0")}:${String(t.m).padStart(2, "0")}` : "—";
}
function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}
function fmtNumber(v: number | null): string {
  if (v == null) return "—";
  const rounded = Math.round(v);
  return Math.abs(v - rounded) < 0.01 ? rounded.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtAirport(v: [string, string] | string | null | undefined): string {
  const [icao, iata] = Array.isArray(v) ? v : [v ?? "", ""];
  if (!icao && !iata) return "—";
  return iata ? `${icao} / ${iata}` : String(icao);
}

// ---------------- detect_mapping ----------------
export function detectMapping(header: string[]): Record<string, string> {
  const norm: Record<string, string> = {};
  for (const h of header) norm[h] = normHeader(h);
  const used = new Set<string>();
  const mapping: Record<string, string> = {};
  for (const exact of [true, false]) {
    for (const fd of FIELDS) {
      if (mapping[fd.key]) continue;
      let best: [number, string] | null = null;
      for (const col of header) {
        const nh = norm[col];
        if (used.has(col) || !nh) continue;
        for (const alias of fd.aliases) {
          const a = normHeader(alias);
          let hit: boolean, score: number;
          if (exact) {
            hit = nh === a;
            score = 1000;
          } else {
            hit = a.includes(nh) || nh.includes(a);
            score = a.length;
          }
          if (hit && (!best || score > best[0])) {
            best = [score, col];
            break;
          }
        }
      }
      if (best) {
        mapping[fd.key] = best[1];
        used.add(best[1]);
      }
    }
  }
  return mapping;
}

// ---------------- compare ----------------
export interface Diff { field: string; label: string; excel: string; flite: string }
export interface Cell { excel: string; flite: string; same: boolean | null; mapped: boolean; verdict: string; detail: string }
export interface RowResult {
  row_no: number;
  callsign: string;
  matched: boolean;
  sector_id: number | null;
  route: string;
  std: string;
  diffs: Diff[];
  note: string;
  cells: Record<string, Cell>;
  ok: boolean;
}
export interface CompareResult {
  sheet: string;
  mapping: Record<string, string>;
  unmapped_columns: string[];
  rows: RowResult[];
  flights_total: number;
  tolerance: number;
  matched: number;
  clean: number;
  mismatched: number;
  not_found: number;
}

function cell(excel: string, flite: string, same: boolean | null, mapped: boolean, verdict = "", detail = ""): Cell {
  return { excel, flite, same, mapped, verdict, detail };
}

function tableCells(flight: Flight, rowdict: Record<string, unknown>, mapping: Record<string, string>, compared: Record<string, Cell>): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const [key] of TABLE_COLUMNS) {
    if (key === "route") {
      const dep = compared["dep"];
      const dest = compared["dest"];
      const got = [dep, dest].filter(Boolean) as Cell[];
      if (got.length) {
        const ex = [dep ? dep.excel : "?", dest ? dest.excel : "?"].filter((_, i) => (i === 0 ? !!dep : !!dest)).join("-");
        out[key] = cell(ex, flight.route, got.every((p) => p.same), true);
      } else {
        out[key] = cell("—", flight.route, null, false);
      }
      continue;
    }
    if (key === "callsign") {
      out[key] = cell(flight.callsign, flight.callsign, true, true);
      continue;
    }
    if (compared[key]) {
      out[key] = compared[key]!;
      continue;
    }
    const fd = BY_KEY[key]!;
    const real = fd.getter(flight);
    const raw = mapping[key] ? rowdict[mapping[key]!] : null;
    out[key] = cell(
      raw != null && raw !== "" ? String(raw).trim() : "—",
      fd.kind !== "crew" ? fmtField(real, fd.kind) : real ? String(real) : "—",
      null,
      false,
    );
  }
  // Giờ ETD theo tên cột (nếu file có cột ETD) — bảng ưu tiên giờ này hơn STD.
  const etdRaw = mapping["etd"] ? rowdict[mapping["etd"]!] : null;
  const etdT = normTime(etdRaw);
  out["etd"] = cell(etdT ? fmtTime(etdT) : "—", fmtField(flight.etd, "time"), null, !!etdT);
  return out;
}

function fmtField(v: unknown, kind: FieldDef["kind"]): string {
  if (kind === "airport") return fmtAirport(v as [string, string]);
  if (v == null || v === "") return "—";
  if (kind === "time") return v instanceof Date ? `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}` : String(v);
  if (kind === "date") return v instanceof Date ? fmtDate(v) : String(v);
  if (kind === "number") return fmtNumber(Number(v));
  return String(v);
}

function index(flights: Flight[]): Map<string, Flight[]> {
  const byCs = new Map<string, Flight[]>();
  for (const f of flights) {
    for (const k of callsignKeys(f.callsign)) {
      if (!byCs.has(k)) byCs.set(k, []);
      byCs.get(k)!.push(f);
    }
  }
  return byCs;
}

function matchAirport(value: string, icao: string, iata: string): boolean {
  const v = normText(value);
  if (!v) return true;
  const set = new Set([normText(icao), normText(iata)]);
  set.delete("");
  return set.has(v);
}

function airportCode(v: unknown): string {
  const s = normText(v);
  return s.length >= 3 && s.length <= 4 && /^[A-Z0-9]+$/.test(s) ? s : "";
}

function routesOf(cands: Flight[]): string {
  const seen: string[] = [];
  for (const f of cands) {
    const std = f.std ? ` ${String(f.std.getUTCHours()).padStart(2, "0")}:${String(f.std.getUTCMinutes()).padStart(2, "0")}Z` : "";
    const r = `${f.dep_icao || "?"}-${f.dest_icao || "?"}${std}`;
    if (!seen.includes(r)) seen.push(r);
  }
  return seen.join(", ") || "—";
}

function filterRoute(cands: Flight[], rowdict: Record<string, unknown>, mapping: Record<string, string>): [Flight[], string] {
  const dep = mapping["dep"] ? airportCode(rowdict[mapping["dep"]!]) : "";
  const dest = mapping["dest"] ? airportCode(rowdict[mapping["dest"]!]) : "";
  if (!cands.length || (!dep && !dest)) return [cands, ""];
  const kept = cands.filter(
    (f) => (!dep || matchAirport(dep, f.dep_icao, f.dep_iata)) && (!dest || matchAirport(dest, f.dest_icao, f.dest_iata)),
  );
  if (kept.length) return [kept, ""];
  return [[], `Excel ghi chặng ${dep || "?"}-${dest || "?"} nhưng FliteBrief chỉ có ${routesOf(cands)} — không ghép để khỏi lấy nhầm crew/reg chặng khác`];
}

const WINDOW_H = 12.0;
const REF_OFFSET_H = -7.0;

export function excelDt(rowdict: Record<string, unknown>, mapping: Record<string, string>): Date | null {
  if (!mapping["date"]) return null;
  const d = normDate(rowdict[mapping["date"]!]);
  if (!d) return null;
  const t = mapping["std"] ? normTime(rowdict[mapping["std"]!]) : null;
  const out = new Date(d.getTime());
  if (t) out.setUTCHours(t.h, t.m, 0, 0);
  return out;
}

function diffH(flight: Flight, dtLocal: Date): number | null {
  if (!flight.std) return null;
  return (flight.std.getTime() - dtLocal.getTime()) / 3600000;
}

/** Crewlist time is local at the departure airport; convert it to UTC with the airport time-zone table. */
export function excelUtc(rowdict: Record<string, unknown>, mapping: Record<string, string>, useEtd = false): Date | null {
  if (useEtd && !mapping["etd"]) return null;
  const dt = excelDt(rowdict, useEtd ? { ...mapping, std: mapping["etd"]! } : mapping);
  if (!dt || !mapping["std"] || !mapping["dep"]) return null;
  const dep = airportCode(rowdict[mapping["dep"]!]);
  const tz = (WORLD_TZ as Record<string, string>)[dep];
  const m = /^([+-])?(\d{1,2}):(\d{2})$/.exec(String(tz || ""));
  if (!m) return null;
  const off = (m[1] === "-" ? -1 : 1) * (Number(m[2]) + Number(m[3]) / 60);
  return new Date(dt.getTime() - off * 3600000);
}

function refOffset(rows: Array<[number, Record<string, unknown>]>, mapping: Record<string, string>, byCs: Map<string, Flight[]>, windowH = WINDOW_H): number {
  const seen: number[] = [];
  for (const [, rowdict] of rows) {
    const dt = excelDt(rowdict, mapping);
    if (!dt) continue;
    const keys = [...callsignKeys(rowdict[mapping["callsign"] ?? ""])].sort((a, b) => b.length - a.length);
    let cands: Flight[] = [];
    for (const k of keys) {
      if (byCs.get(k)?.length) {
        cands = byCs.get(k)!;
        break;
      }
    }
    const [kept] = filterRoute(cands, rowdict, mapping);
    const near = kept.map((f) => diffH(f, dt)).filter((d): d is number => d != null && Math.abs(d) <= windowH);
    if (near.length === 1) seen.push(near[0]!);
  }
  if (!seen.length) return REF_OFFSET_H;
  seen.sort((a, b) => a - b);
  return seen[Math.floor(seen.length / 2)]!;
}

function pickByTime(cands: Flight[], dtLocal: Date, rowdict: Record<string, unknown>, mapping: Record<string, string>, refH: number, windowH = WINDOW_H): [Flight | null, string] {
  const near = cands.map((f) => [f, diffH(f, dtLocal)] as [Flight, number | null]).filter((x): x is [Flight, number] => x[1] != null && Math.abs(x[1]) <= windowH);
  if (!near.length) return [null, ""];
  const inWindow = near.length;
  const [kept, why] = filterRoute(near.map(([f]) => f), rowdict, mapping);
  if (why) return [null, why];
  const keepSet = new Set(kept);
  let filtered = near.filter(([f]) => keepSet.has(f));
  const byRoute = filtered.length < inWindow;
  if (filtered.length === 1) {
    const [f, d] = filtered[0]!;
    const notes: string[] = [];
    if (byRoute) notes.push(`${inWindow} chặng cùng số hiệu trong ±${windowH.toFixed(0)}h, chọn theo chặng bay`);
    if (Math.abs(d) >= 0.5) notes.push(`lệch ${d >= 0 ? "+" : ""}${d.toFixed(0)}h so với giờ Excel (giờ địa phương ↔ UTC)`);
    return [f, notes.join("; ")];
  }
  filtered = [...filtered].sort((a, b) => Math.abs(a[1] - refH) - Math.abs(b[1] - refH));
  const [best, d0] = filtered[0]!;
  const second = Math.abs(filtered[1]![1] - refH);
  let note = `${filtered.length} chặng cùng số hiệu trong ±${windowH.toFixed(0)}h, chọn chặng lệch ${d0 >= 0 ? "+" : ""}${d0.toFixed(0)}h (khớp độ lệch chung ${refH >= 0 ? "+" : ""}${refH.toFixed(0)}h)`;
  if (Math.abs(Math.abs(d0 - refH) - second) < 0.5) {
    note = `CẢNH BÁO: ${filtered.length} chặng cùng số hiệu trong ±${windowH.toFixed(0)}h mà độ lệch giống nhau — không tách được, kết quả có thể thuộc chặng khác`;
  }
  return [best, note];
}

function pick(cands: Flight[], rowdict: Record<string, unknown>, mapping: Record<string, string>): [Flight | null, string] {
  if (!cands.length) return [null, ""];
  const total = cands.length;
  const [kept, why] = filterRoute(cands, rowdict, mapping);
  if (why) return [null, why];
  if (kept.length === 1) return [kept[0]!, total === 1 ? "" : `có ${total} chặng cùng số hiệu trong ngày, chọn theo chặng bay`];
  return [kept[0]!, `CẢNH BÁO: ${kept.length} chặng cùng số hiệu trong ngày mà không tách được theo chặng bay — kết quả có thể thuộc chặng khác`];
}

function resolve(rowdict: Record<string, unknown>, mapping: Record<string, string>, byCs: Map<string, Flight[]>, refH: number, windowH = WINDOW_H): [Flight | null, string, string] {
  const keys = [...callsignKeys(rowdict[mapping["callsign"] ?? ""])].sort((a, b) => b.length - a.length);
  if (!keys.length) return [null, "", ""];
  let cands: Flight[] = [];
  for (const k of keys) {
    if (byCs.get(k)?.length) {
      cands = byCs.get(k)!;
      break;
    }
  }
  if (!cands.length) return [null, "", "không có chuyến này trên FliteBrief"];

  const dt = excelDt(rowdict, mapping);
  if (!dt) {
    const [f, note] = pick(cands, rowdict, mapping);
    if (!f) return [null, "", note];
    return [f, cands.length > 1 && !note ? `callsign trùng ${cands.length} chuyến` : note, ""];
  }

  const utc = excelUtc(rowdict, mapping);
  const utcEtd = excelUtc(rowdict, mapping, true);
  if (utcEtd) {
    // ETD (giờ dự kiến mới) khớp đúng STD UTC của CFP thì không báo lệch.
    const [fe, noteE] = pickByTime(cands, utcEtd, rowdict, mapping, 0, windowH);
    if (fe && !/lệch/.test(noteE)) return [fe, noteE, ""];
  }
  if (utc) {
    // Giờ UTC tự tính từ múi giờ sân bay đi: không còn "lệch −7h/−9h" giả.
    const [fu, noteU] = pickByTime(cands, utc, rowdict, mapping, 0, windowH);
    if (fu) return [fu, noteU.replace(/so với giờ Excel \(giờ địa phương ↔ UTC\)/, "so với giờ UTC tính từ Crewlist"), ""];
    if (noteU) return [null, "", noteU];
  }
  const [f, note] = pickByTime(cands, dt, rowdict, mapping, refH, windowH);
  if (f) return [f, note, ""];
  if (note) return [null, "", note];

  const co = [...new Set(cands.filter((c) => c.std).map((c) => `${String(c.std!.getUTCDate()).padStart(2, "0")}/${String(c.std!.getUTCMonth() + 1).padStart(2, "0")} ${String(c.std!.getUTCHours()).padStart(2, "0")}:${String(c.std!.getUTCMinutes()).padStart(2, "0")}Z`))].sort().join(", ") || "—";
  const gaps = cands.map((c) => diffH(c, dt)).filter((d): d is number => d != null);
  if (!gaps.length) return [null, "", `chuyến trên FliteBrief không có giờ STD (${co})`];
  const near = gaps.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  const days = (near - refH) / 24.0;
  const dtStr = `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")} ${String(dt.getUTCHours()).padStart(2, "0")}:${String(dt.getUTCMinutes()).padStart(2, "0")}`;

  if (Math.abs(near) <= windowH * 1.6) {
    return [null, "", `lệch ${near >= 0 ? "+" : ""}${near.toFixed(1)}h so với ${co} — quá ngưỡng ±${windowH.toFixed(0)}h một ít (độ lệch chung của file là ${refH >= 0 ? "+" : ""}${refH.toFixed(0)}h), có thể cùng chuyến mà giờ đã thay đổi — nên kiểm tra tay`];
  }
  if (Math.abs(days - Math.round(days)) < 0.15 && Math.round(days) !== 0) {
    const n = Math.abs(Math.round(days));
    const khi = Math.round(days) < 0 ? "trước" : "sau";
    return [null, "", `FliteBrief chỉ có chặng của ${n} ngày ${khi} (${co}) — chuyến ngày ${dtStr.split(" ")[0]} chưa có trong dữ liệu API (cửa sổ chỉ ~24h quanh hiện tại)`];
  }
  return [null, "", `không có chuyến nào trong ±${windowH.toFixed(0)}h quanh ${dtStr}; FliteBrief có ${co} (lệch ${near >= 0 ? "+" : ""}${near.toFixed(0)}h) — gần như chắc là chặng của ngày khác, chuyến ngày này chưa vào cửa sổ API`];
}

export function mergeRows(sheet: Sheet, mapping: Record<string, string>): Array<[number, Record<string, unknown>]> {
  const csCol = mapping["callsign"];
  const crewCol = mapping["crew"];
  const out: Array<[number, Record<string, unknown>]> = [];
  let i = 0;
  for (const row of sheetDicts(sheet)) {
    const rowNo = sheet.header_row + 2 + i;
    i++;
    if (callsignKeys(csCol ? row[csCol] : null).size) {
      out.push([rowNo, { ...row }]);
      continue;
    }
    if (out.length && crewCol) {
      const extra = row[crewCol];
      if (extra != null && extra !== "") {
        const prev = out[out.length - 1]![1];
        const cur = prev[crewCol];
        prev[crewCol] = cur != null && cur !== "" ? `${cur}; ${extra}` : extra;
      }
    }
  }
  return out;
}

export function mergedRow(sheet: Sheet, mapping: Record<string, string>, rowNo: number): [number, Record<string, unknown>] | null {
  for (const [no, row] of mergeRows(sheet, mapping)) {
    if (no === rowNo) return [no, row];
  }
  return null;
}

export function cellsForRow(flight: Flight, rowdict: Record<string, unknown>, mapping: Record<string, string>, keys: string[] = ["crew", "reg"]): Record<string, Cell> {
  const cells: Record<string, Cell> = {};
  for (const key of keys) {
    if (!mapping[key] || !BY_KEY[key]) continue;
    const fd = BY_KEY[key]!;
    const raw = rowdict[mapping[key]!];
    const real = fd.getter(flight);
    let same: boolean, detail: string, mismatch: number;
    if (fd.kind === "crew") {
      const [nBad, why] = crewVerdict(raw, flight.crews);
      same = nBad === 0;
      mismatch = nBad;
      detail = why;
    } else {
      same = normText(raw) === normText(real);
      detail = "";
      mismatch = same ? 0 : 1;
    }
    const showA = raw != null && raw !== "" ? String(raw).trim() : "—";
    const showB = real != null && real !== "" ? String(real).trim() : "—";
    cells[key] = { excel: showA, flite: showB, same, mapped: true, verdict: same ? "TRUE" : `FALSE ${mismatch}`, detail };
  }
  return cells;
}

export function matchedFlights(sheet: Sheet, flights: Flight[], mapping?: Record<string, string>): Flight[] {
  const mp = mapping || detectMapping(sheet.header);
  if (!mp["callsign"]) return [];
  const byCs = index(flights);
  const rows = mergeRows(sheet, mp);
  const refH = refOffset(rows, mp, byCs);
  const out = new Map<number, Flight>();
  for (const [, rowdict] of rows) {
    const [found] = resolve(rowdict, mp, byCs, refH);
    if (found) out.set(found.id, found);
  }
  return [...out.values()];
}

export function compare(sheet: Sheet, flights: Flight[], opts: { mapping?: Record<string, string>; tolerance?: number; fields?: string[] | null } = {}): CompareResult {
  const mapping = opts.mapping || detectMapping(sheet.header);
  const tolerance = opts.tolerance ?? 0;
  if (!mapping["callsign"]) {
    throw new Error(`Không tìm thấy cột callsign / số hiệu chuyến bay trong Excel — các cột đọc được: ${sheet.header.slice(0, 20).join(", ")}`);
  }
  let checked = Object.keys(mapping).filter((k) => k !== "callsign" && k !== "date");
  if (opts.fields) checked = checked.filter((k) => opts.fields!.includes(k));

  const byCs = index(flights);
  const rows = mergeRows(sheet, mapping);
  const refH = refOffset(rows, mapping, byCs);
  const results: RowResult[] = [];

  for (const [rowNo, rowdict] of rows) {
    const csRaw = rowdict[mapping["callsign"]!];
    const keys = callsignKeys(csRaw);
    const cs = normText(csRaw);
    if (!keys.size) continue;

    const [flight, pickNote, note] = resolve(rowdict, mapping, byCs, refH);
    if (!flight) {
      results.push({ row_no: rowNo, callsign: String(csRaw || "").trim(), matched: false, sector_id: null, route: "", std: "", diffs: [], note, cells: {}, ok: false });
      continue;
    }

    const diffs: Diff[] = [];
    const cells: Record<string, Cell> = {};
    for (const key of checked) {
      const fd = BY_KEY[key]!;
      const raw = rowdict[mapping[key]!];
      const real = fd.getter(flight);
      let mismatch = 1;
      let detail = "";
      let same: boolean;
      let showA: string, showB: string;
      if (fd.kind === "number") {
        const a = normNumber(raw), b = normNumber(real as number | null);
        same = a == null || b == null ? a == null && b == null : Math.abs(a - b) <= tolerance;
        showA = fmtNumber(a);
        showB = fmtNumber(b);
      } else if (fd.kind === "time") {
        const a = normTime(raw);
        const b = real instanceof Date ? { h: real.getUTCHours(), m: real.getUTCMinutes() } : normTime(real);
        same = !!a && !!b && a.h === b.h && a.m === b.m || (!a && !b);
        showA = fmtTime(a);
        showB = fmtTime(b);
      } else if (fd.kind === "date") {
        const a = normDate(raw);
        const b = real instanceof Date ? real : normDate(real);
        same = (a?.getTime() ?? null) === (b?.getTime() ?? null);
        showA = fmtDate(a);
        showB = fmtDate(b);
      } else if (fd.kind === "airport") {
        const [icao, iata] = (Array.isArray(real) ? real : [real, ""]) as [string, string];
        const ex = normText(raw);
        const set = new Set([normText(icao), normText(iata)]);
        set.delete("");
        same = set.has(ex) || (!ex && !icao && !iata);
        showA = raw != null && raw !== "" ? String(raw).trim() : "—";
        showB = icao ? `${icao}${iata ? ` / ${iata}` : ""}` : "—";
      } else if (fd.kind === "actype") {
        same = normActype(raw) === normActype(real);
        showA = raw != null && raw !== "" ? String(raw).trim() : "—";
        showB = real != null && real !== "" ? String(real).trim() : "—";
      } else if (fd.kind === "crew") {
        const [nBad, why] = crewVerdict(raw, flight.crews);
        same = nBad === 0;
        mismatch = nBad;
        detail = why;
        showA = raw != null && raw !== "" ? String(raw).trim() : "—";
        showB = real != null && real !== "" ? String(real).trim() : "—";
      } else {
        same = normText(raw) === normText(real);
        showA = raw != null && raw !== "" ? String(raw).trim() : "—";
        showB = real != null && real !== "" ? String(real).trim() : "—";
      }
      cells[key] = { excel: showA, flite: showB, same, mapped: true, verdict: same ? "TRUE" : `FALSE ${mismatch}`, detail };
      if (!same) diffs.push({ field: key, label: fd.label, excel: showA, flite: showB });
    }

    results.push({
      row_no: rowNo,
      callsign: flight.callsign,
      matched: true,
      sector_id: flight.id,
      route: flight.route,
      std: flight.std ? `${String(flight.std.getUTCDate()).padStart(2, "0")}/${String(flight.std.getUTCMonth() + 1).padStart(2, "0")} ${String(flight.std.getUTCHours()).padStart(2, "0")}:${String(flight.std.getUTCMinutes()).padStart(2, "0")}` : "",
      diffs,
      note: note || pickNote,
      cells: tableCells(flight, rowdict, mapping, cells),
      ok: !diffs.length,
    });
  }

  const mappedCols = new Set(Object.values(mapping));
  return {
    sheet: sheet.name,
    mapping,
    unmapped_columns: sheet.header.filter((h) => !mappedCols.has(h)),
    rows: results,
    flights_total: flights.length,
    tolerance,
    matched: results.filter((r) => r.matched).length,
    clean: results.filter((r) => r.ok).length,
    mismatched: results.filter((r) => r.matched && r.diffs.length).length,
    not_found: results.filter((r) => !r.matched).length,
  };
}
