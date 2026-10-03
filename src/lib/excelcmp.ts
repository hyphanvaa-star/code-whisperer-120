// Port of excelcmp/ (reader + compare) and xlsdiff.py from the original tool.
// Runs in the browser: the file never leaves the dispatcher's machine.
import type { Crew, Flight } from "./flight-model";

export type Cell = string | number | boolean | Date | null;
export type Sheet = { name: string; header: string[]; rows: Cell[][]; headerRow: number };
type Row = Record<string, Cell>;

// ---------------- reader ----------------
const clean = (v: Cell) => (v == null ? "" : String(v instanceof Date ? v.toISOString() : v).split(/\s+/).filter(Boolean).join(" "));

function scoreHeader(row: Cell[]) {
  const filled = row.map(clean).filter(Boolean);
  if (filled.length < 2) return 0;
  let texty = 0;
  for (const v of filled) if (Number.isNaN(Number(v.replace(/,/g, "")))) texty++;
  return texty * 2 + new Set(filled.map((v) => v.toLowerCase())).size + filled.length;
}

function dedupe(h: string[]) {
  const seen: Record<string, number> = {};
  return h.map((x, i) => {
    let name = x || `col${i + 1}`;
    const k = name.toLowerCase();
    if (seen[k]) name = `${name}_${++seen[k]}`;
    else seen[k] = 1;
    return name;
  });
}

function toSheet(name: string, rows: Cell[][]): Sheet | null {
  if (!rows.length) return null;
  let bi = 0, bs = -1;
  rows.slice(0, 25).forEach((r, i) => {
    const s = scoreHeader(r);
    if (s > bs) { bi = i; bs = s; }
  });
  if (bs <= 0) return null;
  const header = dedupe(rows[bi]!.map(clean));
  const body = rows.slice(bi + 1).filter((r) => r.some((v) => clean(v))).slice(0, 20000);
  return { name, header, rows: body, headerRow: bi };
}

function parseCsv(text: string): Cell[][] {
  const delim = ((text.split("\n")[0] ?? "").match(/;/g)?.length ?? 0) > ((text.split("\n")[0] ?? "").match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: Cell[][] = [];
  let row: Cell[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); out.push(row); row = []; cur = "";
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

export async function readTable(file: File): Promise<Sheet[]> {
  const name = file.name.toLowerCase();
  const raw: [string, Cell[][]][] = [];
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    raw.push([file.name, parseCsv(await file.text())]);
  } else if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    wb.eachSheet((ws) => {
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: true }, (r, n) => {
        const vals: Cell[] = [];
        for (let c = 1; c <= ws.columnCount; c++) {
          let v = r.getCell(c).value as unknown;
          if (v && typeof v === "object" && !(v instanceof Date)) {
            const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
            v = o.result ?? o.text ?? (o.richText ? o.richText.map((t) => t.text).join("") : null);
          }
          vals.push((v ?? null) as Cell);
        }
        rows[n - 1] = vals;
      });
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      raw.push([ws.name, rows]);
    });
  } else {
    throw new Error("Chỉ hỗ trợ .xlsx, .xlsm, .csv (file .xls/.xlsb cũ hãy Save As .xlsx)");
  }
  const sheets = raw.map(([n, r]) => toSheet(n, r)).filter((s): s is Sheet => !!s);
  if (!sheets.length) throw new Error(`${file.name}: không tìm thấy bảng dữ liệu nào`);
  return sheets;
}

const dicts = (s: Sheet): Row[] => s.rows.map((r) => Object.fromEntries(s.header.map((h, i) => [h, r[i] ?? null])));

// ---------------- normalisation ----------------
const NON_ALNUM = /[^a-z0-9]+/g;
const normHeader = (h: string) => h.trim().toLowerCase().replace(/#/g, " no ").replace(NON_ALNUM, " ").trim();
export const normText = (v: unknown) => (v == null ? "" : String(v).trim().toLowerCase().replace(NON_ALNUM, "").toUpperCase());
const NEO: Record<string, string> = { A21N: "321", A20N: "320", A19N: "319", A339: "330", A338: "330", A33N: "330", B38M: "737", B39M: "737" };
export function normActype(v: unknown) {
  if (v == null) return "";
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (NEO[s]) return NEO[s];
  const m = s.match(/^[A-Z]?(\d{3})$/);
  return m ? m[1] : s;
}
export function normNumber(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  if (typeof v === "number") return v;
  let s = String(v).trim().replace(/\b(kg|kgs|lb|lbs|t|tons?)\b/gi, "").replace(/[\s\u00a0]/g, "");
  if (s.includes(",") && !s.includes(".")) {
    const i = s.lastIndexOf(","), head = s.slice(0, i), tail = s.slice(i + 1);
    s = tail.length <= 2 && head ? `${head}.${tail}` : s.replace(/,/g, "");
  } else s = s.replace(/,/g, "");
  const n = Number(s);
  return s && Number.isFinite(n) ? n : null;
}
const nameTokens = (v: unknown) => new Set(v == null ? [] : String(v).toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length > 1));

const CREW_PAIR = /\(([^)]*)\)\s*-?\s*(\d{3,6})/g;
const strip0 = (s: string) => s.replace(/^0+/, "");
export const crewEntries = (raw: unknown): [string, string][] =>
  raw == null ? [] : [...String(raw).matchAll(CREW_PAIR)].map((m) => [m[1]!.trim(), m[2]!]);
export function staffIds(raw: unknown, skipDhd = true): Set<string> {
  if (raw == null) return new Set();
  const pairs = crewEntries(raw);
  if (pairs.length) return new Set(pairs.filter(([f]) => !(skipDhd && f.toUpperCase().includes("DHD"))).map(([, i]) => strip0(i)));
  const t = String(raw);
  const a = [...t.matchAll(/\)\s*-?\s*(\d{3,6})/g)].map((m) => strip0(m[1]!));
  return new Set(a.length ? a : [...t.matchAll(/\b(\d{3,6})\b/g)].map((m) => strip0(m[1]!)));
}
export const dhdIds = (raw: unknown) => new Set(crewEntries(raw).filter(([f]) => f.toUpperCase().includes("DHD")).map(([, i]) => strip0(i)));
const crewId = (u: string) => strip0(String(u || "").match(/(\d+)\s*$/)?.[1] ?? "");
const sorted = (s: Iterable<string>) => [...s].sort();
const minus = (a: Set<string>, b: Set<string>) => new Set([...a].filter((x) => !b.has(x)));

export function crewVerdict(raw: unknown, crews: Crew[]): [number, string] {
  const ex = staffIds(raw), boEx = dhdIds(raw);
  const fb = new Set<string>(), boFb = new Set<string>();
  for (const c of crews) {
    const i = crewId(c.username);
    if (i) (c.deadheading ? boFb : fb).add(i);
  }
  let note = "";
  if (boEx.size || boFb.size) {
    const ai = sorted(new Set([...boEx, ...boFb]));
    note = ` · bỏ ${ai.length} DHD: ${ai.join(", ")}`;
  }
  if (!ex.size && !fb.size) return [0, "hai bên đều chưa có tổ bay" + note];
  if (!ex.size) {
    if (boEx.size && !fb.size) return [0, `Excel chỉ có ${boEx.size} người DHD, bỏ hết` + note];
    const toks = nameTokens(raw);
    if ([...toks].some((t) => t.length >= 3)) {
      const real = new Set<string>();
      for (const c of crews) for (const t of [...nameTokens(c.name), ...nameTokens(c.username)]) real.add(t);
      return [...toks].every((t) => real.has(t)) ? [0, "khớp theo tên" + note] : [1, "tên không khớp" + note];
    }
    return [fb.size, `Excel không ghi ai, FliteBrief có ${fb.size} người` + note];
  }
  const missing = minus(ex, fb);
  let extra = minus(fb, ex);
  const lamViec = new Set([...extra].filter((x) => boEx.has(x)));
  extra = minus(extra, lamViec);
  const n = Math.max(missing.size, extra.size) + lamViec.size;
  if (n === 0) return [0, `khớp cả ${ex.size} mã: ${sorted(ex).join(", ")}` + note];
  const parts: string[] = [];
  if (missing.size) parts.push("Excel có mà FliteBrief không: " + sorted(missing).join(", "));
  if (extra.size) parts.push("FliteBrief có mà Excel không: " + sorted(extra).join(", "));
  if (lamViec.size) parts.push("Excel ghi DHD nhưng FliteBrief xếp làm tổ bay: " + sorted(lamViec).join(", "));
  return [n, parts.join(" · ") + note];
}

export function callsignKeys(v: unknown): string[] {
  const full = normText(v);
  if (!full) return [];
  const d = full.replace(/\D/g, "");
  return d && d !== full ? [full, d] : [full];
}

// Dates/times as "naive" ms (local wall clock encoded via Date.UTC).
type DayV = { y: number; m: number; d: number };
type TimeV = { h: number; mi: number };
const MON: Record<string, number> = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
export function normDate(v: Cell): DayV | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate() };
  if (typeof v === "number") {
    const dt = new Date((v - 25569) * 86400000);
    return Number.isNaN(dt.getTime()) ? null : { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  const s = String(v).trim().toUpperCase();
  const ok = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? { y: y < 100 ? 2000 + y : y, m, d } : null);
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/))) return ok(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return ok(+m[3]!, +m[2]!, +m[1]!);
  if ((m = s.match(/^(\d{1,2})([A-Z]{3})(\d{2,4})$/)) && MON[m[2]!]) return ok(+m[3]!, MON[m[2]!], +m[1]!);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return ok(+m[1]!, +m[2]!, +m[3]!);
  return null;
}
export function normTime(v: Cell): TimeV | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return { h: v.getUTCHours(), mi: v.getUTCMinutes() };
  if (typeof v === "number") {
    const frac = v - Math.trunc(v);
    if (frac >= 0 && v < 10 && (frac > 0 || v === 0)) {
      const mins = Math.round(frac * 1440);
      return { h: Math.floor(mins / 60) % 24, mi: mins % 60 };
    }
    const n = Math.trunc(v);
    if (n >= 0 && n <= 2359 && n % 100 < 60) return { h: Math.floor(n / 100) % 24, mi: n % 100 };
    return null;
  }
  const s = String(v).trim().toUpperCase().replace(/Z/g, "");
  let m = s.match(/^(\d{1,2})[:H.](\d{2})/);
  if (m) return +m[2] < 60 ? { h: +m[1] % 24, mi: +m[2] } : null;
  m = s.match(/^\d{3,4}$/);
  if (m) { const h = +s.slice(0, -2), mi = +s.slice(-2); return mi < 60 ? { h: h % 24, mi } : null; }
  return null;
}
const hhmm = (t: TimeV | null) => (t ? `${String(t.h).padStart(2, "0")}:${String(t.mi).padStart(2, "0")}` : "");
const ddmm = (d: DayV | null) => (d ? `${String(d.d).padStart(2, "0")}/${String(d.m).padStart(2, "0")}` : "");
const naive = (d: DayV, t: TimeV | null) => Date.UTC(d.y, d.m - 1, d.d, t?.h ?? 0, t?.mi ?? 0);
const fmtNaive = (ms: number) => { const x = new Date(ms); return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")} ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`; };

// ---------------- fields ----------------
type Kind = "text" | "number" | "time" | "date" | "airport" | "actype" | "crew";
type FieldDef = { key: string; label: string; aliases: string[]; get: (f: Flight, crews: Crew[]) => unknown; kind: Kind };
const pax = (f: Flight) => (f.pax.adults ?? 0) + (f.pax.children ?? 0) + (f.pax.infants ?? 0) || null;
const utcTime = (iso: string | null) => (iso ? { h: new Date(iso).getUTCHours(), mi: new Date(iso).getUTCMinutes() } : null);
export const FIELDS: FieldDef[] = [
  { key: "callsign", label: "Callsign", aliases: ["callsign", "call sign", "flight", "flightno", "flight no", "flt", "fltno", "flight number", "so hieu", "chuyen bay"], get: (f) => f.callsign, kind: "text" },
  { key: "date", label: "Ngày", aliases: ["date", "day", "ngay", "flight date", "std date", "dep date"], get: (f) => f.std, kind: "date" },
  { key: "std", label: "STD", aliases: ["std", "dep time", "departure", "gio di", "off block", "scheduled", "sched"], get: (f) => utcTime(f.std), kind: "time" },
  { key: "etd", label: "ETD", aliases: ["etd", "revised etd", "new etd", "estimated dep", "gio etd"], get: (f) => utcTime(f.etd), kind: "time" },
  { key: "sta", label: "STA", aliases: ["sta", "eta", "arr time", "arrival", "gio den"], get: (f) => utcTime(f.sta), kind: "time" },
  { key: "dep", label: "Sân bay đi", aliases: ["dep", "from", "origin", "dep icao", "dep iata", "departure airport", "san bay di"], get: (f) => [f.dep, f.depIata], kind: "airport" },
  { key: "dest", label: "Sân bay đến", aliases: ["dest", "to", "destination", "arr", "dest icao", "dest iata", "san bay den"], get: (f) => [f.dest, f.destIata], kind: "airport" },
  { key: "reg", label: "Reg", aliases: ["reg", "registration", "tail", "so dang ky"], get: (f) => f.reg, kind: "text" },
  { key: "ac_type", label: "Loại tàu", aliases: ["ac", "acft", "ac type", "actype", "aircraft", "aircraft type", "loai tau"], get: (f) => f.acType, kind: "actype" },
  { key: "dispatcher", label: "Dispatcher", aliases: ["dispatcher", "dsp", "nguoi lam", "planner"], get: (f) => f.dispatcher, kind: "text" },
  { key: "block_fuel", label: "Block fuel", aliases: ["block fuel", "blockfuel", "block", "total fuel", "fuel", "tof", "takeoff fuel", "planned fuel"], get: (f) => f.fuel.total, kind: "number" },
  { key: "taxi_fuel", label: "Taxi fuel", aliases: ["taxi", "taxi fuel"], get: (f) => f.fuel.taxi, kind: "number" },
  { key: "reserve_fuel", label: "Reserve", aliases: ["reserve", "rsv", "final reserve"], get: (f) => f.fuel.reserve, kind: "number" },
  { key: "alt_fuel", label: "Alt fuel", aliases: ["alt fuel", "alternate fuel"], get: (f) => f.fuel.alternate, kind: "number" },
  { key: "cont_fuel", label: "Cont fuel", aliases: ["cont", "contingency", "cont fuel"], get: (f) => f.fuel.contingency, kind: "number" },
  { key: "extra_fuel", label: "Extra fuel", aliases: ["extra", "extra fuel", "discretionary"], get: (f) => f.fuel.extra, kind: "number" },
  { key: "tow", label: "TOW", aliases: ["tow", "takeoff weight", "tkof weight"], get: (f) => f.tow, kind: "number" },
  { key: "lw", label: "LW", aliases: ["lw", "landing weight", "ldw"], get: (f) => f.lwt, kind: "number" },
  { key: "pax", label: "PAX", aliases: ["pax", "passenger", "so khach"], get: pax, kind: "number" },
  { key: "alt1", label: "Alternate", aliases: ["alt1", "alt", "alternate", "altn", "alternate 1", "du bi"], get: (f) => f.alt1, kind: "text" },
  { key: "cfp_no", label: "CFP NO", aliases: ["cfp no", "cfpno", "cfp", "plan no", "planno", "ofp no", "plan number", "so cfp"], get: (f) => f.planNo, kind: "text" },
  { key: "crew_count", label: "Số crew", aliases: ["crew no", "crew count", "so crew", "sl crew", "crew qty"], get: (f) => f.crewCount || null, kind: "number" },
  { key: "crew", label: "Crew", aliases: ["crew", "captain", "cpt", "pic", "commander", "to bay", "tobay", "crew name", "phi cong"], get: (_f, c) => c.map((x) => x.name).join("; "), kind: "crew" },
];
const BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const TABLE_COLUMNS: [string, string][] = [
  ["callsign", "CALLSIGN"], ["route", "ROUTE"], ["std", "NGÀY GIỜ"], ["crew", "CREW"], ["reg", "REG"],
  ["dispatcher", "DSP"], ["alt1", "ALT"], ["cfp_no", "CFP NO"], ["block_fuel", "FUEL"],
];
export const DEFAULT_FIELDS = ["crew", "reg"];

export type Mapping = Record<string, string>;
export function detectMapping(header: string[]): Mapping {
  const norm = header.map((h) => [h, normHeader(h)] as const);
  const used = new Set<string>();
  const mp: Mapping = {};
  for (const exact of [true, false]) {
    for (const fd of FIELDS) {
      if (mp[fd.key]) continue;
      let best: [number, string] | null = null;
      for (const [col, nh] of norm) {
        if (used.has(col) || !nh) continue;
        for (const al of fd.aliases) {
          const a = normHeader(al);
          const hit = exact ? nh === a : nh.includes(a) || a.includes(nh);
          const score = exact ? 1000 : a.length;
          if (hit) { if (!best || score > best[0]) best = [score, col]; break; }
        }
      }
      if (best) { mp[fd.key] = best[1]; used.add(best[1]); }
    }
  }
  return mp;
}

export function mergeRows(sheet: Sheet, mp: Mapping): [number, Row][] {
  const out: [number, Row][] = [];
  const cs = mp.callsign, crew = mp.crew;
  dicts(sheet).forEach((row, i) => {
    const no = sheet.headerRow + 2 + i;
    if (callsignKeys(cs ? row[cs] : null).length) { out.push([no, { ...row }]); return; }
    if (out.length && crew) {
      const extra = row[crew];
      if (extra != null && extra !== "") {
        const prev = out[out.length - 1][1];
        prev[crew] = prev[crew] != null && prev[crew] !== "" ? `${prev[crew]}; ${extra}` : extra;
      }
    }
  });
  return out;
}

// ---------------- matching ----------------
const WINDOW_H = 12;
const REF_OFFSET_H = -7;
type Index = Map<string, Flight[]>;
function index(flights: Flight[]): Index {
  const m: Index = new Map();
  for (const f of flights) for (const k of callsignKeys(f.callsign)) { const l = m.get(k) ?? []; l.push(f); m.set(k, l); }
  return m;
}
const airportCode = (v: unknown) => { const s = normText(v); return s.length >= 3 && s.length <= 4 ? s : ""; };
const matchAirport = (v: string, icao: string, iata: string) => !v || [normText(icao), normText(iata)].filter(Boolean).includes(v);
const routesOf = (c: Flight[]) => [...new Set(c.map((f) => `${f.dep || "?"}-${f.dest || "?"}${f.std ? " " + f.std.slice(11, 16) + "Z" : ""}`))].join(", ") || "—";
function filterRoute(c: Flight[], row: Row, mp: Mapping): [Flight[], string] {
  const dep = mp.dep ? airportCode(row[mp.dep]) : "", dest = mp.dest ? airportCode(row[mp.dest]) : "";
  if (!c.length || !(dep || dest)) return [c, ""];
  const kept = c.filter((f) => matchAirport(dep, f.dep, f.depIata) && matchAirport(dest, f.dest, f.destIata));
  if (kept.length) return [kept, ""];
  return [[], `Excel ghi chặng ${dep || "?"}-${dest || "?"} nhưng FliteBrief chỉ có ${routesOf(c)} — không ghép để khỏi lấy nhầm crew/reg chặng khác`];
}
function excelDt(row: Row, mp: Mapping): number | null {
  if (!mp.date) return null;
  const d = normDate(row[mp.date]);
  if (!d) return null;
  return naive(d, mp.std ? normTime(row[mp.std]) : null);
}
const diffH = (f: Flight, dt: number) => (f.std ? (new Date(f.std).getTime() - dt) / 3600000 : null);
const candsOf = (row: Row, mp: Mapping, by: Index) => {
  for (const k of [...callsignKeys(row[mp.callsign ?? ""])].sort((a, b) => b.length - a.length)) if (by.get(k)?.length) return by.get(k)!;
  return [];
};
function refOffset(rows: [number, Row][], mp: Mapping, by: Index): number {
  const seen: number[] = [];
  for (const [, r] of rows) {
    const dt = excelDt(r, mp);
    if (dt == null) continue;
    const [c] = filterRoute(candsOf(r, mp, by), r, mp);
    const near = c.map((f) => diffH(f, dt)).filter((d): d is number => d != null && Math.abs(d) <= WINDOW_H);
    if (near.length === 1) seen.push(near[0]);
  }
  if (!seen.length) return REF_OFFSET_H;
  seen.sort((a, b) => a - b);
  return seen[Math.floor(seen.length / 2)];
}
const sgn = (n: number, d = 0) => (n >= 0 ? "+" : "") + n.toFixed(d);
function pickByTime(c: Flight[], dt: number, row: Row, mp: Mapping, ref: number): [Flight | null, string] {
  let near = c.map((f) => [f, diffH(f, dt)] as const).filter((x): x is readonly [Flight, number] => x[1] != null && Math.abs(x[1]) <= WINDOW_H);
  if (!near.length) return [null, ""];
  const inWin = near.length;
  const [kept, why] = filterRoute(near.map((x) => x[0]), row, mp);
  if (why) return [null, why];
  near = near.filter((x) => kept.includes(x[0]));
  const byRoute = near.length < inWin;
  if (near.length === 1) {
    const [f, d] = near[0];
    const notes: string[] = [];
    if (byRoute) notes.push(`${inWin} chặng cùng số hiệu trong ±12h, chọn theo chặng bay`);
    if (Math.abs(d) >= 0.5) notes.push(`lệch ${sgn(d)}h so với giờ Excel (giờ địa phương ↔ UTC)`);
    return [f, notes.join("; ")];
  }
  near = [...near].sort((a, b) => Math.abs(a[1] - ref) - Math.abs(b[1] - ref));
  const [best, d0] = near[0];
  const second = Math.abs(near[1][1] - ref);
  let note = `${near.length} chặng cùng số hiệu trong ±12h, chọn chặng lệch ${sgn(d0)}h (khớp độ lệch chung ${sgn(ref)}h)`;
  if (Math.abs(Math.abs(d0 - ref) - second) < 0.5) note = `CẢNH BÁO: ${near.length} chặng cùng số hiệu trong ±12h mà độ lệch giống nhau — không tách được, kết quả có thể thuộc chặng khác`;
  return [best, note];
}
function pick(c: Flight[], row: Row, mp: Mapping): [Flight | null, string] {
  if (!c.length) return [null, ""];
  const [kept, why] = filterRoute(c, row, mp);
  if (why) return [null, why];
  if (kept.length === 1) return [kept[0], c.length === 1 ? "" : `có ${c.length} chặng cùng số hiệu trong ngày, chọn theo chặng bay`];
  return [kept[0], `CẢNH BÁO: ${kept.length} chặng cùng số hiệu trong ngày mà không tách được theo chặng bay — kết quả có thể thuộc chặng khác`];
}
function resolve(row: Row, mp: Mapping, by: Index, ref: number): [Flight | null, string, string] {
  if (!callsignKeys(row[mp.callsign ?? ""]).length) return [null, "", ""];
  const c = candsOf(row, mp, by);
  if (!c.length) return [null, "", "không có chuyến này trên FliteBrief"];
  const dt = excelDt(row, mp);
  if (dt == null) {
    const [f, note] = pick(c, row, mp);
    if (!f) return [null, "", note];
    return [f, note || (c.length > 1 ? `callsign trùng ${c.length} chuyến` : ""), ""];
  }
  const [f, note] = pickByTime(c, dt, row, mp, ref);
  if (f) return [f, note, ""];
  if (note) return [null, "", note];
  const co = [...new Set(c.filter((x) => x.std).map((x) => `${x.std!.slice(8, 10)}/${x.std!.slice(5, 7)} ${x.std!.slice(11, 16)}Z`))].sort().join(", ") || "—";
  const gaps = c.map((x) => diffH(x, dt)).filter((d): d is number => d != null);
  if (!gaps.length) return [null, "", `chuyến trên FliteBrief không có giờ STD (${co})`];
  const near = gaps.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  const days = (near - ref) / 24;
  if (Math.abs(near) <= WINDOW_H * 1.6)
    return [null, "", `lệch ${sgn(near, 1)}h so với ${co} — quá ngưỡng ±12h một ít (độ lệch chung của file là ${sgn(ref)}h), có thể cùng chuyến mà giờ đã thay đổi — nên kiểm tra tay`];
  const rd = Math.round(days);
  if (Math.abs(days - rd) < 0.15 && rd !== 0)
    return [null, "", `FliteBrief chỉ có chặng của ${Math.abs(rd)} ngày ${rd < 0 ? "trước" : "sau"} (${co}) — chuyến ngày ${fmtNaive(dt).slice(0, 5)} chưa có trong dữ liệu (hãy tăng số ngày tải)`];
  return [null, "", `không có chuyến nào trong ±12h quanh ${fmtNaive(dt)}; FliteBrief có ${co} (lệch ${sgn(near)}h) — gần như chắc là chặng của ngày khác`];
}

export function matchedFlights(sheet: Sheet, flights: Flight[], mp: Mapping): Flight[] {
  if (!mp.callsign) return [];
  const by = index(flights), rows = mergeRows(sheet, mp), ref = refOffset(rows, mp, by);
  const out = new Map<number, Flight>();
  for (const [, r] of rows) { const [f] = resolve(r, mp, by, ref); if (f) out.set(f.id, f); }
  return [...out.values()];
}

// ---------------- compare ----------------
export type CellOut = { excel: string; flite: string; same: boolean | null; mapped: boolean; verdict: string; detail: string };
export type RowResult = { rowNo: number; callsign: string; matched: boolean; sectorId: number | null; route: string; std: string; diffs: { field: string; label: string; excel: string; flite: string }[]; note: string; cells: Record<string, CellOut> };
export type CompareResult = { sheet: string; mapping: Mapping; unmapped: string[]; rows: RowResult[]; flightsTotal: number; matched: number; clean: number; mismatched: number; notFound: number };

const show = (v: unknown) => (v == null || v === "" ? "—" : String(v).trim());
const fmtNumber = (n: number | null) => (n == null ? "—" : Math.abs(n - Math.round(n)) < 0.01 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
function fmtReal(v: unknown, kind: Kind): string {
  if (kind === "airport") { const [i, a] = v as [string, string]; return !i && !a ? "—" : a ? `${i} / ${a}` : i; }
  if (v == null || v === "") return "—";
  if (kind === "time") return hhmm(v as TimeV) || "—";
  if (kind === "date") return typeof v === "string" ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "—";
  if (kind === "number") return fmtNumber(Number(v));
  return String(v);
}

export function compare(sheet: Sheet, flights: Flight[], crewsBySector: Map<number, Crew[]>, opts: { mapping: Mapping; tolerance: number; fields?: string[] }): CompareResult {
  const mp = opts.mapping;
  if (!mp.callsign) throw new Error(`Không tìm thấy cột callsign / số hiệu chuyến bay trong Excel — các cột đọc được: ${sheet.header.slice(0, 20).join(", ")}`);
  let checked = Object.keys(mp).filter((k) => k !== "callsign" && k !== "date");
  if (opts.fields) checked = checked.filter((k) => opts.fields!.includes(k));
  const by = index(flights), rows = mergeRows(sheet, mp), ref = refOffset(rows, mp, by);
  const results: RowResult[] = [];
  for (const [rowNo, r] of rows) {
    const csRaw = r[mp.callsign];
    if (!callsignKeys(csRaw).length) continue;
    const [f, pickNote, miss] = resolve(r, mp, by, ref);
    if (!f) { results.push({ rowNo, callsign: show(csRaw), matched: false, sectorId: null, route: "", std: "", diffs: [], note: miss, cells: {} }); continue; }
    const crews = crewsBySector.get(f.id) ?? [];
    const cells: Record<string, CellOut> = {};
    const diffs: RowResult["diffs"] = [];
    for (const key of checked) {
      const fd = BY_KEY[key];
      const raw = r[mp[key]];
      const real = fd.get(f, crews);
      let same: boolean, a: string, b: string, mism = 1, detail = "";
      if (fd.kind === "number") {
        const x = normNumber(raw), y = normNumber(real);
        same = x == null || y == null ? x == null && y == null : Math.abs(x - y) <= opts.tolerance;
        a = fmtNumber(x); b = fmtNumber(y);
      } else if (fd.kind === "time") {
        const x = normTime(raw), y = real as TimeV | null;
        same = hhmm(x) === hhmm(y); a = hhmm(x) || "—"; b = hhmm(y) || "—";
      } else if (fd.kind === "date") {
        const x = normDate(raw), y = f.std ? normDate(f.std.slice(0, 10)) : null;
        same = JSON.stringify(x) === JSON.stringify(y); a = x ? `${ddmm(x)}/${x.y}` : "—"; b = y ? `${ddmm(y)}/${y.y}` : "—";
      } else if (fd.kind === "airport") {
        const [i, ia] = real as [string, string];
        const ex = normText(raw);
        same = [normText(i), normText(ia)].filter(Boolean).includes(ex) || (!ex && !i && !ia);
        a = show(raw); b = i ? i + (ia ? ` / ${ia}` : "") : "—";
      } else if (fd.kind === "actype") {
        same = normActype(raw) === normActype(real); a = show(raw); b = show(real);
      } else if (fd.kind === "crew") {
        const [n, why] = crewVerdict(raw, crews);
        same = n === 0; mism = n; detail = why; a = show(raw); b = show(real);
      } else {
        same = normText(raw) === normText(real); a = show(raw); b = show(real);
      }
      cells[key] = { excel: a, flite: b, same, mapped: true, verdict: same ? "TRUE" : `FALSE ${mism}`, detail };
      if (!same) diffs.push({ field: key, label: fd.label, excel: a, flite: b });
    }
    // table cells
    const tc: Record<string, CellOut> = {};
    const blank = (excel: string, flite: string, same: boolean | null, mapped: boolean): CellOut => ({ excel, flite, same, mapped, verdict: "", detail: "" });
    for (const [key] of TABLE_COLUMNS) {
      if (key === "route") {
        const got = [cells.dep, cells.dest].filter(Boolean);
        tc.route = got.length ? blank([cells.dep?.excel, cells.dest?.excel].filter(Boolean).join("-"), `${f.dep}-${f.dest}`, got.every((p) => p.same), true) : blank("—", `${f.dep}-${f.dest}`, null, false);
      } else if (key === "callsign") tc.callsign = blank(f.callsign, f.callsign, true, true);
      else if (cells[key]) tc[key] = cells[key];
      else {
        const fd = BY_KEY[key];
        const real = fd.get(f, crews);
        tc[key] = blank(mp[key] ? show(r[mp[key]]) : "—", key === "std" ? (f.std ? `${f.std.slice(8, 10)}/${f.std.slice(5, 7)} ${f.std.slice(11, 16)}Z` : "—") : fd.kind === "crew" ? show(real) : fmtReal(real, fd.kind), null, false);
      }
    }
    results.push({ rowNo, callsign: f.callsign, matched: true, sectorId: f.id, route: `${f.dep}-${f.dest}`, std: f.std ? `${f.std.slice(8, 10)}/${f.std.slice(5, 7)} ${f.std.slice(11, 16)}` : "", diffs, note: miss || pickNote, cells: tc });
  }
  const used = new Set(Object.values(mp));
  return {
    sheet: sheet.name, mapping: mp, unmapped: sheet.header.filter((h) => !used.has(h)), rows: results, flightsTotal: flights.length,
    matched: results.filter((r) => r.matched).length,
    clean: results.filter((r) => r.matched && !r.diffs.length).length,
    mismatched: results.filter((r) => r.matched && r.diffs.length).length,
    notFound: results.filter((r) => !r.matched).length,
  };
}

// ---------------- xlsdiff: two versions of the same day's plan ----------------
type Leg = { rowNo: number; flt: string; digits: string; dep: string; arr: string; day: DayV | null; std: TimeV | null; etd: TimeV | null; reg: string; crewRaw: string; crew: Set<string>; dhd: Set<string> };
const legWhen = (l: Leg) => (l.day ? naive(l.day, l.std) : null);
export function readLegs(sheet: Sheet): Leg[] {
  const mp = detectMapping(sheet.header);
  if (!mp.callsign) throw new Error(`${sheet.name}: không tìm ra cột số hiệu chuyến bay`);
  const out: Leg[] = [];
  for (const [rowNo, r] of mergeRows(sheet, mp)) {
    const raw = r[mp.callsign];
    const digits = String(raw ?? "").replace(/\D/g, "").replace(/^0+/, "");
    if (!digits) continue;
    const crewRaw = mp.crew ? String(r[mp.crew] ?? "") : "";
    out.push({
      rowNo, flt: String(raw ?? "").trim(), digits,
      dep: mp.dep ? String(r[mp.dep] ?? "").trim().toUpperCase() : "",
      arr: mp.dest ? String(r[mp.dest] ?? "").trim().toUpperCase() : "",
      day: mp.date ? normDate(r[mp.date]) : null,
      std: mp.std ? normTime(r[mp.std]) : null,
      etd: mp.etd ? normTime(r[mp.etd]) : null,
      reg: mp.reg ? String(r[mp.reg] ?? "").trim() : "",
      crewRaw, crew: staffIds(crewRaw), dhd: dhdIds(crewRaw),
    });
  }
  return out;
}
const normReg = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");
const wrapMin = (a: number, b: number) => { const m = Math.round((b - a) / 60000); return m - Math.round(m / 1440) * 1440; };
const stamp = (l: Leg, t: TimeV | null) => (t ? naive(l.day ?? { y: 2000, m: 1, d: 1 }, t) : null);

export type VerRow = {
  flt: string; route: string; stdOld: string; stdNew: string; dayNew: string;
  reg: { changed: boolean; old: string; new: string };
  crew: { changed: boolean; out: string[]; in: string[]; dhd: string[] };
  delay: { min: number; from: string; to: string; kind: "" | "first" | "retime" };
  atc: string;
};
export type VerResult = { rows: VerRow[]; added: Leg[]; removed: Leg[]; oldLegs: number; newLegs: number; warn: string; nReg: number; nCrew: number; nDelay: number };

function pair(olds: Leg[], news: Leg[]): [Leg | null, Leg | null][] {
  if (olds.length === 1 && news.length === 1) return [[olds[0], news[0]]];
  const free = [...news];
  const out: [Leg | null, Leg | null][] = [];
  for (const o of [...olds].sort((a, b) => (legWhen(a) ?? Infinity) - (legWhen(b) ?? Infinity))) {
    if (!free.length) { out.push([o, null]); continue; }
    const ow = legWhen(o);
    if (ow == null) { out.push([o, free.shift()!]); continue; }
    const gap = (n: Leg) => { const w = legWhen(n); return w == null ? 1e15 : Math.abs(w - ow); };
    const best = free.reduce((a, b) => (gap(b) < gap(a) ? b : a));
    free.splice(free.indexOf(best), 1);
    out.push([o, best]);
  }
  for (const n of free) out.push([null, n]);
  return out;
}

export function diffVersions(oldSheet: Sheet, newSheet: Sheet): VerResult {
  const olds = readLegs(oldSheet), news = readLegs(newSheet);
  const group = (l: Leg[]) => { const m = new Map<string, Leg[]>(); for (const x of l) { const k = `${x.digits}|${x.dep}|${x.arr}`; m.set(k, [...(m.get(k) ?? []), x]); } return m; };
  const bo = group(olds), bn = group(news);
  const daysOf = (l: Leg[]) => { const c = new Map<string, number>(); for (const x of l) if (x.day) { const k = `${ddmm(x.day)}/${x.day.y}`; c.set(k, (c.get(k) ?? 0) + 1); } return [...c.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]); };
  const od = daysOf(olds), nd = daysOf(news);
  const warn = od[0] && nd[0] && od[0] !== nd[0] ? `Hai bản KHÔNG cùng ngày: bản cũ chủ yếu ${od[0]}, bản mới ${nd[0]}. Công cụ này để so hai phiên bản của CÙNG một ngày — so khác ngày thì gần như chuyến nào cũng bị coi là đổi tàu / đổi crew.` : "";
  const rows: VerRow[] = [], added: Leg[] = [], removed: Leg[] = [];
  for (const key of [...new Set([...bo.keys(), ...bn.keys()])].sort()) {
    for (const [o, n] of pair(bo.get(key) ?? [], bn.get(key) ?? [])) {
      if (!o) { added.push(n!); continue; }
      if (!n) { removed.push(o); continue; }
      const regCh = normReg(o.reg) !== normReg(n.reg);
      const crewIn = sorted(minus(n.crew, o.crew)), crewOut = sorted(minus(o.crew, n.crew));
      const crewCh = crewIn.length > 0 || crewOut.length > 0;
      let kind: VerRow["delay"]["kind"] = "";
      if (n.etd) kind = !o.etd ? "first" : hhmm(o.etd) === hhmm(n.etd) ? "" : "retime";
      let dmin = 0;
      if (kind) {
        const a = kind === "first" ? stamp(n, n.std) ?? stamp(o, o.std) : stamp(o, o.etd);
        const b = stamp(n, n.etd);
        if (a != null && b != null) dmin = wrapMin(a, b);
      }
      if (!(regCh || crewCh || dmin)) continue;
      rows.push({
        flt: n.flt, route: `${n.dep}-${n.arr}`, stdOld: hhmm(o.std), stdNew: hhmm(n.std), dayNew: ddmm(n.day),
        reg: { changed: regCh, old: o.reg || "—", new: n.reg || "—" },
        crew: { changed: crewCh, out: crewOut, in: crewIn, dhd: sorted(new Set([...o.dhd, ...n.dhd])) },
        delay: { min: dmin, from: hhmm(o.etd), to: hhmm(n.etd), kind },
        atc: regCh && dmin ? "CHG DLA" : regCh ? "CHG" : dmin ? "DLA" : "",
      });
    }
  }
  rows.sort((a, b) => Math.abs(b.delay.min) - Math.abs(a.delay.min) || Number(!a.reg.changed) - Number(!b.reg.changed) || Number(!a.crew.changed) - Number(!b.crew.changed) || a.flt.localeCompare(b.flt));
  return { rows, added, removed, oldLegs: olds.length, newLegs: news.length, warn, nReg: rows.filter((r) => r.reg.changed).length, nCrew: rows.filter((r) => r.crew.changed).length, nDelay: rows.filter((r) => r.delay.min).length };
}
export const legLabel = (l: Leg) => `${l.flt} ${l.dep}-${l.arr}${l.day ? " " + ddmm(l.day) : ""}${l.std ? " " + hhmm(l.std) : ""}`;
