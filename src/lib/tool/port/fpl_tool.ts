// Port of fpl_tool.py (pure parts) — sinh khoi FPL.req theo cong thuc sheet TOOL.
import { IATA_ICAO } from "./limits_check";
import * as taf from "./taf";
import type { TafRec } from "./taf";

export type Raw = Record<string, any>;

export const TAXI_STANDARD: Record<string, number> = { A333: 500, A320: 200, A321: 200, A21N: 200 };

export const ALT_COLUMNS: Record<string, string> = {
  A: "PODPOA", C: "ETP_POD", D: "TALT", F: "FL", G: "ETP_POA", H: "ALT1", I: "ALT2",
};

export function _num(v: any): string {
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  return String(v ?? "").trim();
}

export function _person(ident: any, name: any): string {
  const left = _num(ident).trim(), right = _num(name).trim();
  if ((left === "" || left === "0") && !right) return "";
  if (left === "" || left === "0") return right;
  if (!right) return left;
  return (left + " " + right).trim();
}

export function _minutes(hhmm: any): number | null {
  const text = String(hhmm ?? "").trim();
  if (text.length < 4 || !text.includes(":")) return null;
  const [hour, minute] = text.split(":", 2);
  const h = parseInt(hour, 10), m = parseInt(minute, 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function _extraText(extra: any): string {
  if (extra == null || String(extra).trim() === "") return "0";
  return _num(extra);
}

export function _acFamily(ac: any): string {
  const text = String(ac ?? "").toUpperCase().replace(/ /g, "");
  if (text.includes("330") || text.startsWith("A33")) return "330";
  if (text.includes("321") || text.includes("32N")) return "321";
  if (text.includes("320")) return "320";
  return "";
}

export function _roundChuc(n: number): number {
  const rem = ((n % 100) + 100) % 100;
  const base = n - rem;
  if (rem >= 55) return base + 100;
  if (rem >= 50) return base + 50;
  return base;
}

export function _roundTram(n: number): number {
  const rem = ((n % 100) + 100) % 100;
  const base = n - rem;
  if (rem >= 50) return base + 100;
  return base;
}

export function round_est(est: number, ac: string): [number | null, string] {
  const family = _acFamily(ac);
  if (family === "320") {
    if (est > 18000) return [null, `EST ${est} lớn hơn 18000, cần tự điều chỉnh`];
    if (est >= 17000) return [_roundChuc(est), ""];
    if (est >= 0) return [_roundChuc(est + 500), ""];
  } else if (family === "321") {
    if (est > 22500) return [null, `EST ${est} lớn hơn 22500, cần tự điều chỉnh`];
    if (est >= 20000) return [_roundChuc(est), ""];
    if (est >= 0) return [_roundChuc(est + 500), ""];
  } else if (family === "330") {
    if (est > 49000) return [null, `EST ${est} lớn hơn 49000, cần tự điều chỉnh`];
    if (est >= 46000) return [_roundTram(est), ""];
    if (est >= 0) return [_roundChuc(est + 1000), ""];
  }
  return [null, "không rõ loại tàu"];
}

function _extraOn(extra: any): boolean {
  const text = String(extra ?? "").trim().toUpperCase().replace(/,/g, "");
  const m = /^(\d+)/.exec(text);
  if (m) return parseInt(m[1], 10) > 0;
  return !!text && text !== "0" && text !== "0M";
}

function _optTail(extra: any, rmk: string | null | undefined): string {
  let note = String(rmk ?? "").trim();
  if (note.startsWith("/")) note = note.slice(1).trim();
  const parts: string[] = [];
  if (_extraOn(extra)) parts.push("/EXTRA FUEL DUE WX ENROUTE AND TRAFFIC");
  if (note) parts.push("/" + note);
  if (!parts.length) return "";
  return " " + parts.join(" ");
}

export function _first(rows: any[][], keyAt = 0): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const row of rows || []) {
    if (!row) continue;
    const key = String(row[keyAt]).trim().toUpperCase();
    if (key && !(key in out)) out[key] = row;
  }
  return out;
}

function _codes(values: any[], endRow: number): Set<string> {
  const count = endRow - 15 + 1;
  const out = new Set<string>();
  for (const v of (values || []).slice(0, count)) {
    const s = String(v ?? "").trim().toUpperCase();
    if (s) out.add(s);
  }
  return out;
}

export function alt_records_from_rows(rows: any[][]): Raw[] {
  const out: Raw[] = [];
  for (const row of rows || []) {
    if (!row) continue;
    const key = String(row[0]).trim().toUpperCase();
    if (!key || key === "PODPOA" || key === "ROUTE") continue;
    const at = (index: number) => (index >= row.length || row[index] === "" ? "" : _num(row[index]));
    out.push({
      podpoa: key, etp_pod: at(2), talt: at(3), fl: at(5), etp_poa: at(6), alt1: at(7), alt2: at(8),
    });
  }
  return out;
}

export function era_records_from_rows(rows: any[][]): Raw[] {
  const out: Raw[] = [];
  for (const row of rows || []) {
    if (!row || row[0] == null || row[0] === "") continue;
    const key = String(row[0]).trim().toUpperCase();
    if (!key || ["ROUTE", "PODPOA", "ERA"].includes(key)) continue;
    const era = row.length < 2 || row[1] == null || row[1] === "" ? "" : _num(row[1]);
    out.push({ route: key, era });
  }
  return out;
}

function _ciAirports(raw: Raw, letter: string): string[] {
  return ((raw.ci_lists || {})[letter] || []).map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => x);
}

export function build_cost_index_library(raw: Raw): Raw {
  const domestic = (raw.domestic || []).map((x: any) => String(x).trim().toUpperCase()).filter((x: string) => x);
  const one = (rid: string, group: string, region: string, vals: string[], airports: string[]) => ({
    id: rid, group, region,
    a320: vals[0], a321ceo: vals[1], a321neo: vals[2], a330: vals[3],
    airports,
  });
  const rows = [
    one("domestic", "", "For Domestic Flight", ["13", "17", "22", "30"], domestic),
    one("vietnam", "intl", "Viet Nam", ["11", "15", "19", "26"], domestic),
    one("sea", "intl", "South East Asia", ["11", "14", "18", "24"], _ciAirports(raw, "L")),
    one("twhk", "intl", "Taiwan/HongKong/Macau", ["12", "15", "20", "27"], _ciAirports(raw, "M")),
    one("japan", "intl", "Japan", ["11", "14", "19", "25"], _ciAirports(raw, "S")),
    one("korea", "intl", "Korea", ["12", "15", "20", "27"], _ciAirports(raw, "N")),
    one("china", "intl", "China", ["11", "14", "18", "24"], _ciAirports(raw, "O")),
    one("kz", "intl", "Kazakhstan", ["", "", "", "18"], []),
    one("india", "intl", "India", ["11", "15", "19", "26"], _ciAirports(raw, "Q")),
    one("aus", "intl", "Australia", ["", "", "18", "25"], _ciAirports(raw, "R")),
    one("russia", "intl", "Russia", ["", "", "14", "19"], []),
    one("extra1", "intl", "", ["", "", "", ""], []),
    one("extra2", "intl", "", ["", "", "", ""], []),
    one("extra3", "intl", "", ["", "", "", ""], []),
  ];
  return { columns: ["A320", "A321CEO", "A321NEO", "A330"], rows };
}

export function save_cost_index(oldDoc: Raw, rows: Raw[]): Raw {
  const old: Record<string, Raw> = {};
  for (const r of (oldDoc.rows || []) as Raw[]) old[String(r.id)] = r;
  const out: Raw[] = [];
  for (const rec of rows || []) {
    const rid = String(rec.id || "").trim() || "extra";
    const prev = old[rid] || {};
    out.push({
      id: rid,
      group: rid !== "domestic" ? "intl" : "",
      region: String(rec.region || "").trim(),
      a320: String(rec.a320 || "").trim(),
      a321ceo: String(rec.a321ceo || "").trim(),
      a321neo: String(rec.a321neo || "").trim(),
      a330: String(rec.a330 || "").trim(),
      airports: [...(prev.airports || [])],
    });
  }
  return { columns: ["A320", "A321CEO", "A321NEO", "A330"], rows: out };
}

export function save_taxi(oldDoc: Raw, rows: Raw[]): Raw {
  const out: Raw[] = [];
  let apt = "";
  for (const rec of rows || []) {
    const got = String(rec.airport || "").trim().toUpperCase();
    if (got) apt = got;
    const kind = String(rec.type || "").trim().toUpperCase();
    const months = ["oct", "nov", "dec"].map((k) => String(rec[k] || "").trim());
    if (!got && !kind && !months.some((m) => m)) {
      out.push({ airport: "", type: "", oct: "", nov: "", dec: "" });
      apt = "";
      continue;
    }
    out.push({
      airport: apt, type: kind,
      oct: String(rec.oct || "").trim(), nov: String(rec.nov || "").trim(), dec: String(rec.dec || "").trim(),
    });
  }
  return { month: "OCT", source: oldDoc.source || "", standard: TAXI_STANDARD, rows: out };
}

export function save_route_table(rows: Raw[]): Raw {
  const out = (rows || []).map((rec) => ({
    route: String(rec.route || "").trim().toUpperCase(),
    kapli: String(rec.kapli || "").trim(),
    envar: String(rec.envar || "").trim(),
    opt: String(rec.opt || "").trim(),
  }));
  return { columns: ["ROUTE", "KAPLI", "ENVAR", "OPT"], rows: out };
}

export function save_alt_rows(oldDoc: Raw, rows: Raw[]): Raw {
  const cleaned = (rows || []).map((rec) => ({
    podpoa: String(rec.podpoa || "").trim().toUpperCase(),
    etp_pod: String(rec.etp_pod || "").trim(),
    talt: String(rec.talt || "").trim(),
    fl: String(rec.fl || "").trim(),
    etp_poa: String(rec.etp_poa || "").trim(),
    alt1: String(rec.alt1 || "").trim(),
    alt2: String(rec.alt2 || "").trim(),
  }));
  return { source: oldDoc.source || "edited", sheet: "ALT ROUTE", columns: ALT_COLUMNS, routes: cleaned };
}

export function save_era_rows(oldDoc: Raw, rows: Raw[]): Raw {
  const cleaned = (rows || []).map((rec) => ({
    route: String(rec.route || "").trim().toUpperCase(),
    era: String(rec.era || "").trim().toUpperCase(),
  }));
  return { source: oldDoc.source || "edited", sheet: "ERA", columns: { A: "ROUTE", B: "ERA" }, routes: cleaned };
}

export function pcr_table_rows(doc: Raw | null): Raw[] {
  if (!doc) return [];
  const labels: Record<string, string> = {};
  const order: string[] = [];
  for (const item of doc.variants || []) {
    if (item.id) { labels[String(item.id)] = String(item.label || item.id); order.push(String(item.id)); }
  }
  const rows: Raw[] = [];
  for (const [icao, apt] of Object.entries(doc.airports || {})) {
    const a = apt as Raw;
    if (!a || typeof a !== "object") continue;
    for (const rwy of a.runways || []) {
      const ids = [...order];
      for (const extra of [...Object.keys(rwy.pcr || {}), ...Object.keys(rwy.p10 || {})]) {
        if (!ids.includes(String(extra))) ids.push(String(extra));
      }
      for (const vid of ids) {
        const limit = (rwy.pcr || {})[vid];
        const plus = (rwy.p10 || {})[vid];
        rows.push({
          icao, iata: a.iata || "", name: a.name || "", rwy: rwy.id || "",
          variant: vid, label: labels[vid] || vid,
          pcr: limit == null ? "" : limit, p10: plus == null ? "" : plus,
        });
      }
    }
  }
  return rows;
}

function _pcrKg(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function save_pcr_table(oldDoc: Raw | null, rows: Raw[]): Raw {
  const doc: Raw = oldDoc || { source: "edited", margin_kg: 500, variants: [], airports: {} };
  const grouped: Record<string, Raw> = {};
  for (const rec of rows || []) {
    let icao = String(rec.icao || "").trim().toUpperCase();
    const iata = String(rec.iata || "").trim().toUpperCase();
    const variant = String(rec.variant || "").trim();
    if (!icao && !iata && !variant) continue;
    if (!icao) icao = iata || "NEW";
    const apt = grouped[icao] || (grouped[icao] = { name: "", iata, runways: {} });
    if (String(rec.name || "").trim()) apt.name = String(rec.name || "").trim();
    if (iata) apt.iata = iata;
    const rwyId = String(rec.rwy || "");
    const rwy = apt.runways[rwyId] || (apt.runways[rwyId] = { id: rwyId, pcr: {}, p10: {} });
    if (variant) {
      rwy.pcr[variant] = _pcrKg(rec.pcr);
      rwy.p10[variant] = _pcrKg(rec.p10);
    }
  }
  const airports: Raw = {};
  for (const [icao, apt] of Object.entries(grouped)) {
    airports[icao] = { name: apt.name, iata: apt.iata, runways: Object.values(apt.runways) };
  }
  doc.airports = airports;
  return doc;
}

// ----------------- Db -----------------
export class Db {
  raw: Raw;
  tlk: string; dsp: string; source: string;
  legend_cpt2: string; legend_fo: string;
  flights: Raw[]; by_id: Record<number, Raw>;
  etp: Record<string, any[]>; alt: Record<string, any[]>;
  alt_route: Record<string, Raw>;
  tz: Record<string, any>;
  taxi: Record<string, any[]>;
  domestic: Set<string>; neo: Set<string>;
  ci_table: any[]; ci_lists: Raw;
  era: Record<string, string>;
  payload: Record<string, any[]>;
  kapli: Record<string, any[]>;
  pcr_head: string[]; pcr_dep: string[]; pcr_grid: any[][]; pcr_reg: Record<string, any[]>;
  ci_rows: Raw[];
  taxi_doc: Raw;
  taxi_oct: Record<string, any>;

  constructor(raw: Raw, opts?: { altRoutesDoc?: Raw | null; eraDoc?: Raw | null; ciDoc?: Raw | null; taxiDoc?: Raw | null }) {
    this.raw = raw;
    this.tlk = String(raw.tlk || "");
    this.dsp = String(raw.dsp || "");
    this.source = String(raw.source || "");
    this.legend_cpt2 = String(raw.legend_cpt2 || "");
    this.legend_fo = String(raw.legend_fo || "");
    this.flights = [...(raw.flights || [])];
    this.by_id = {};
    for (const f of this.flights) this.by_id[parseInt(f.row, 10)] = f;
    this.etp = _first(raw.etp || []);
    this.alt = _first(raw.alt || []);
    this.alt_route = Db._loadAltRoute(raw, opts?.altRoutesDoc);
    this.tz = {};
    for (const row of raw.tz || []) if (row && row[0]) this.tz[row[0]] = row[1];
    this.taxi = _first(raw.taxi || []);
    this.domestic = new Set((raw.domestic || []).map((x: any) => String(x).toUpperCase()));
    this.neo = new Set((raw.neo || []).map((x: any) => String(x).toUpperCase()));
    this.ci_table = raw.ci_table || [];
    this.ci_lists = raw.ci_lists || {};
    this.era = Db._loadEra(raw, opts?.eraDoc);
    this.payload = _first(raw.payload || []);
    const kapli = (raw.kapli || []).slice(0, 6);
    this.kapli = _first(kapli);
    let head = [...(raw.pcr_head || [])];
    if (head.length === 1 && typeof head[0] === "string" && head[0].startsWith("(")) {
      head = Db._parseTuple(head[0]);
    }
    this.pcr_head = head.map((v) => _num(v).toUpperCase());
    this.pcr_dep = (raw.pcr_dep || []).map((v: any) => String(v).toUpperCase());
    this.pcr_grid = raw.pcr_grid || [];
    this.pcr_reg = _first(raw.pcr_reg || []);
    const ciDoc = opts?.ciDoc ?? build_cost_index_library(raw);
    this.ci_rows = ciDoc.rows || [];
    this.taxi_doc = opts?.taxiDoc ?? { month: "OCT", source: "", standard: TAXI_STANDARD, rows: [] };
    this.taxi_oct = {};
    for (const rec of this.taxi_doc.rows || []) {
      const apt = String(rec.airport || "").trim().toUpperCase();
      const kind = String(rec.type || "").trim().toUpperCase();
      const val = rec.oct;
      if (apt && kind && val !== "" && val != null) {
        const key = apt + "|" + kind;
        if (!(key in this.taxi_oct)) this.taxi_oct[key] = val;
      }
    }
  }

  static _parseTuple(text: string): string[] {
    // Python tuple literal like "('a', 'b')" — split naively on quotes.
    const out: string[] = [];
    const re = /'([^']*)'|"([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? "");
    return out;
  }

  static _loadAltRoute(raw: Raw, doc?: Raw | null): Record<string, Raw> {
    const rows: Raw[] = doc ? (doc.routes || []) : alt_records_from_rows(raw.alt || []);
    const found: Record<string, Raw> = {};
    for (const rec of rows) {
      const key = String(rec.podpoa || "").trim().toUpperCase();
      if (key && !(key in found)) found[key] = rec;
    }
    return found;
  }

  static _loadEra(raw: Raw, doc?: Raw | null): Record<string, string> {
    if (doc) {
      const found: Record<string, string> = {};
      for (const rec of doc.routes || []) {
        const key = String(rec.route || "").trim().toUpperCase();
        if (key && !(key in found)) found[key] = String(rec.era || "");
      }
      return found;
    }
    const found: Record<string, string> = {};
    for (const row of raw.era || []) {
      if (row && row[0] && !(String(row[0]).toUpperCase() in found)) {
        found[String(row[0]).toUpperCase()] = row.length < 2 ? "" : _num(row[1]);
      }
    }
    return found;
  }

  flight(rowId: number): Raw | null {
    return this.by_id[rowId] ?? null;
  }
}

function _routeKey(flight: Raw): string {
  return String(flight.dep || "").toUpperCase() + String(flight.arr || "").toUpperCase();
}

export function route_defaults(db: Db, flight: Raw): Raw {
  const rec = db.alt_route[_routeKey(flight)] || {};
  return {
    route_q: String(rec.etp_pod || ""),
    etp_poa: String(rec.etp_poa || ""),
    talt: String(rec.talt || ""),
    fl: String(rec.fl || ""),
    alt1: String(rec.alt1 || ""),
    alt2: String(rec.alt2 || ""),
  };
}

function _utc(etd: string, tz: string): string {
  const start0 = _minutes(etd), offset = _minutes(tz);
  if (start0 === null || offset === null) return "";
  let start = start0;
  if (start < offset) start += 24 * 60;
  start -= offset;
  start = ((start % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = Math.floor(start / 60), mm = start % 60;
  return String(hh).padStart(2, "0") + String(mm).padStart(2, "0");
}

function _dateMatch(s: string): [number, number, number] | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;
  return [parseInt(m[1], 10), parseInt(m[2], 10), year];
}

export function eta_utc_when(db: Db, flight: Raw): Date | null {
  const dm = _dateMatch(String(flight.date || ""));
  if (!dm) return null;
  const [day, month, year] = dm;
  const dep = String(flight.dep || "").toUpperCase();
  const arr = String(flight.arr || "").toUpperCase();
  const depM = _minutes(String(flight.etd || ""));
  const arrM = _minutes(String(flight.eta || "") || String(flight.sta || ""));
  const depOff = _minutes(String(db.tz[dep] || ""));
  const arrOff = _minutes(String(db.tz[arr] || ""));
  if (depM === null || arrM === null || depOff === null || arrOff === null) return null;
  const base = Date.UTC(year, month - 1, day);
  if (Number.isNaN(base)) return null;
  const departed = base + (depM - depOff) * 60000;
  let arrived = base + (arrM - arrOff) * 60000;
  if (arrived < departed) arrived += 24 * 3600000;
  return new Date(arrived);
}

export function etd_utc_when(db: Db, flight: Raw): Date | null {
  const dm = _dateMatch(String(flight.date || ""));
  if (!dm) return null;
  const [day, month, year] = dm;
  const depM = _minutes(String(flight.etd || ""));
  const depOff = _minutes(String(db.tz[String(flight.dep || "").toUpperCase()] || ""));
  if (depM === null || depOff === null) return null;
  const base = Date.UTC(year, month - 1, day);
  if (Number.isNaN(base)) return null;
  return new Date(base + (depM - depOff) * 60000);
}

function _icaoOf(code: string): string {
  const raw = String(code || "").trim().toUpperCase();
  if (raw.length === 4 && /^[A-Z]+$/.test(raw)) return raw;
  if (raw.length !== 3 || !/^[A-Z]+$/.test(raw)) return "";
  return IATA_ICAO[raw] || "";
}

export function taf_at(code: string, when: Date | null, tafs: Record<string, TafRec>, role: string): Raw | null {
  const icao = _icaoOf(code);
  if (!icao || when === null) return null;
  const advice = taf.adviceWindow(icao, when, tafs);
  const hh = String(when.getUTCHours()).padStart(2, "0");
  const mm = String(when.getUTCMinutes()).padStart(2, "0");
  return {
    code: String(code || "").trim().toUpperCase(),
    icao, role, when: `${hh}:${mm}Z`,
    segments: [...(advice.segments || [])],
    raw: advice.raw || advice.snippet || "",
    extra: Math.trunc(advice.extra_need || 0),
    why: String(advice.extra_why || advice.tip || ""),
    status: advice.status,
  };
}

export function eta_utc_hhmm(db: Db, flight: Raw): string {
  const when = eta_utc_when(db, flight);
  if (when === null) return "";
  return String(when.getUTCHours()).padStart(2, "0") + String(when.getUTCMinutes()).padStart(2, "0");
}

export function extra_from_taf(
  db: Db, flight: Raw, tafs: Record<string, TafRec>, alts?: (string | undefined)[],
): [string, string, Raw[]] {
  const arrived = eta_utc_when(db, flight);
  const departed = etd_utc_when(db, flight);
  const places: Raw[] = [];
  const seen = new Set<string>();
  const take = (code: string, when: Date | null, role: string): Raw | null => {
    const pack = taf_at(code, when, tafs, role);
    if (!pack) return null;
    const key = pack.icao + "|" + pack.when;
    if (seen.has(key)) return pack;
    seen.add(key);
    places.push(pack);
    return pack;
  };
  take(String(flight.dep || ""), departed, "ETD");
  const dest = take(String(flight.arr || ""), arrived, "ETA");
  for (const code of alts || []) {
    if (code) take(code, arrived, "ETA");
  }
  if (dest === null) {
    if (arrived === null) return ["", "không có ETA", places];
    return ["", "không có TAF " + String(flight.arr || ""), places];
  }
  if (dest.status === "missing" && !Math.trunc(dest.extra || 0)) {
    return ["", dest.why || "không có TAF", places];
  }
  return [String(Math.trunc(dest.extra || 0)), String(dest.why || ""), places];
}

export function _suffix(routeTable: Raw[], route: string, etdHhmm: string): string {
  let hit: Raw | null = null;
  for (const rec of routeTable || []) {
    if (String(rec.route || "").toUpperCase() === String(route || "").toUpperCase()) { hit = rec; break; }
  }
  if (!hit) return "1";
  const number = parseInt(etdHhmm, 10);
  if (!Number.isFinite(number)) return "1";
  const picked = number > 1500 ? hit.envar : hit.kapli;
  const text = String(picked ?? "").trim();
  return text || "1";
}

function _taxiType(ac: string, reg: string, neo: Set<string>): string {
  if (ac === "330") return "A333";
  if (ac === "321" && neo.has(reg)) return "A21N";
  if (ac === "321") return "A321";
  if (ac === "320") return "A320";
  return "";
}

export function _tx(db: Db, ac: string, reg: string, dep: string): any {
  const kind = _taxiType(ac, reg, db.neo);
  const val = kind ? db.taxi_oct[dep + "|" + kind] : undefined;
  if (val !== "" && val != null) return val;
  if (kind === "A333") return 500;
  return 200;
}

function _ciColumn(ac: string, reg: string, neo: Set<string>): string {
  if (ac === "330") return "a330";
  if (ac === "321" && neo.has(reg)) return "a321neo";
  if (ac === "321") return "a321ceo";
  if (ac === "320") return "a320";
  return "";
}

export function _ci(db: Db, dep: string, arr: string, ac: string, reg: string): string {
  const col = _ciColumn(ac, reg, db.neo);
  if (!col) return "";
  const rows = db.ci_rows || [];
  const byId: Record<string, Raw> = {};
  for (const r of rows) byId[String(r.id)] = r;
  let domestic = new Set<string>((byId.domestic?.airports || []).map((x: any) => String(x).toUpperCase()));
  if (!domestic.size) domestic = db.domestic;
  let chosen: Raw | null = null;
  if (domestic.has(dep) && domestic.has(arr)) chosen = byId.domestic;
  else if (domestic.has(dep)) chosen = byId.vietnam;
  else {
    for (const rec of rows) {
      if (["domestic", "vietnam"].includes(String(rec.id))) continue;
      if ((rec.airports || []).map((x: any) => String(x).toUpperCase()).includes(dep)) { chosen = rec; break; }
    }
  }
  if (!chosen) return "";
  return String(chosen[col] || "").trim();
}

function _hold(db: Db, route: string, arr: string, sta: string, ac: string, alt1: string, alt2: string): string {
  if (alt1) {
    let text = `${alt1}/${arr}${alt1}1/100/300`;
    if (alt2) text += `,${alt2}/${arr}${alt2}1/100/300`;
    return "HLD÷30," + text;
  }
  const row = db.etp[route];
  if (!row) return "HLD÷30,";
  const staMin = _minutes(sta);
  const night = ac === "330" || (staMin !== null && (staMin < 6 * 60 || staMin >= 19 * 60));
  const pair = String((night ? row[4] : row[1]) || "");
  const left = pair.slice(0, 3);
  const right = pair.length >= 3 ? pair.slice(-3) : pair;
  return `HLD÷30,${left}/${arr}${left}1,${right}/${arr}${right}1`;
}

function _profile(ac: string, fl: string, found: boolean): string {
  if (ac === "330") return "PRO÷I,T,M,100,410";
  if (!found) return "PRO÷I,T,M,100,350";
  if (fl === "") return "PRO÷I,T,M";
  return "PRO÷I,T,M," + _num(fl);
}

function _pcr(db: Db, dep: string, reg: string): string {
  const regRow = db.pcr_reg[reg];
  if (!regRow || regRow.length < 3) return "";
  const depAt = db.pcr_dep.indexOf(dep);
  const colAt = db.pcr_head.indexOf(_num(regRow[2]).toUpperCase());
  if (depAt < 0 || colAt < 0) return "";
  if (depAt >= db.pcr_grid.length || colAt >= (db.pcr_grid[depAt] || []).length) return "";
  return _num(db.pcr_grid[depAt][colAt]);
}

// ----------------- PCR takeoff weight (uses pcr_limits.json like python) -----------------
const _PCR_SKIP = new Set(["CXR", "DAD"]);
const _JP_HINT: Record<string, string> = {
  "320D": "A320", A32S: "A320", "321D": "A321", "32SK": "A321", "321G": "A21N", A33T: "A330",
};

export function pcr_weights(
  db: Db, dep: string, reg: string,
  pcrDoc: Raw | null, specOf?: (reg: string) => { mtow?: number; type?: string } | null,
  pickVariant?: (hint: string, mtow: number) => { id?: string } | null,
): [string, string] {
  const code = String(dep || "").toUpperCase();
  if (_PCR_SKIP.has(code)) return ["", ""];
  let wv = "";
  if (specOf && pickVariant) {
    const spec = specOf(reg) || {};
    const hint = _JP_HINT[String(spec.type || "").toUpperCase()];
    if (spec.mtow != null && hint) {
      const variant = pickVariant(hint, Math.trunc(spec.mtow));
      wv = String(variant?.id || "");
    }
  }
  if (!wv || !pcrDoc) return ["", ""];
  const airports = pcrDoc.airports || {};
  let apt: Raw | null = null;
  for (const a of Object.values(airports) as Raw[]) {
    if (a && typeof a === "object" && String(a.iata || "").toUpperCase() === code) { apt = a; break; }
  }
  if (!apt) return ["", ""];
  let best: [number, number] | null = null;
  for (const rwy of apt.runways || []) {
    const limit = _pcrKg((rwy.pcr || {})[wv]);
    if (limit === null) continue;
    let plus = _pcrKg((rwy.p10 || {})[wv]);
    if (plus === null) plus = Math.round(limit * 1.1);
    if (best === null || limit < best[0]) best = [limit, plus];
  }
  if (best === null) return ["", ""];
  return [String(best[0]), String(best[1])];
}

// ----------------- render_fpl -----------------
export type RenderOpts = {
  extra?: any; seq?: any;
  route_q?: string | null; etp_poa?: string | null; fl?: string | null;
  talt?: string | null; alt1?: string | null; alt2?: string | null;
  rte?: string | null; rmk?: string | null; pcr_choice?: string | null;
  cpt_id?: any; cpt_name?: any; fo_id?: any; fo_name?: any;
  dsp?: string | null; pay?: string | null; utc_choice?: string | null;
  routeTable?: Raw[];
  pcrTakeoff?: (db: Db, dep: string, reg: string) => string;
};

export function render_fpl(db: Db, flight: Raw, opts: RenderOpts = {}): string {
  const dep = String(flight.dep || "").toUpperCase();
  const arr = String(flight.arr || "").toUpperCase();
  const ac = _num(flight.ac);
  const reg = String(flight.reg || "").toUpperCase();
  const flt = _num(flight.flt);
  const route = dep + arr;
  const defaults = route_defaults(db, flight);
  let routeQ = opts.route_q === undefined ? undefined : opts.route_q;
  if (routeQ == null) routeQ = defaults.route_q;
  routeQ = String(routeQ || "");
  let etpPoa = opts.etp_poa == null ? defaults.etp_poa : opts.etp_poa;
  let fl = opts.fl == null ? defaults.fl : opts.fl;
  etpPoa = String(etpPoa || ""); fl = String(fl || "");
  let talt = opts.talt == null ? defaults.talt : opts.talt;
  let alt1 = opts.alt1 == null ? defaults.alt1 : opts.alt1;
  let alt2 = opts.alt2 == null ? defaults.alt2 : opts.alt2;
  talt = String(talt || ""); alt1 = String(alt1 || ""); alt2 = String(alt2 || "");
  const etdLocal = String(flight.etd || "");
  let utc = _utc(etdLocal, String(db.tz[dep] || ""));
  if (opts.utc_choice != null) utc = String(opts.utc_choice).replace(/\D/g, "");
  const suffix = opts.rte != null && opts.rte !== "" ? String(opts.rte).trim() : _suffix(opts.routeTable || [], route, utc);
  const cpt = _person(opts.cpt_id !== undefined ? opts.cpt_id : flight.cpt_id, opts.cpt_name !== undefined ? opts.cpt_name : flight.cpt_name);
  const cpt2 = _person(flight.cpt2_id, flight.cpt2_name);
  const fo = _person(opts.fo_id !== undefined ? opts.fo_id : flight.fo_id, opts.fo_name !== undefined ? opts.fo_name : flight.fo_name);
  const dspName = opts.dsp == null ? String(db.dsp || "") : String(opts.dsp).trim();
  const extraS = _extraText(opts.extra ?? 0);
  const base = `OPT÷FP,WXUK,KILOS,RN,AW,DRFT,OPGF,CS/VJC${flt},TLK/${db.tlk}${_optTail(opts.extra ?? 0, opts.rmk)}`;
  let opt: string;
  if (!cpt2) opt = `${base},CPT/${cpt},FOF/${fo},DSP/${dspName}`;
  else if (!fo) opt = `${base},CPT/${cpt},FOF/${cpt2},DSP/${dspName}`;
  else if (cpt2 === db.legend_cpt2 && fo === db.legend_fo) opt = `${base},CPT/${cpt2},FOF/${fo},DSP/${dspName}`;
  else opt = `${base},CPT/${cpt},FOF/${fo},DSP/${dspName}`;
  const altBit = talt ? ",ALT=" + talt : "";
  const poa = "POA÷" + arr + etpPoa;
  const era = db.era[route];
  const pcr = _pcr(db, dep, reg);
  let field: string;
  if (era !== undefined && era !== "") field = `16F÷A${extraS},603,ERA=${era}${pcr}`;
  else field = `16F÷A${extraS}${pcr},I`;
  const takeoff = opts.pcr_choice == null
    ? (opts.pcrTakeoff ? opts.pcrTakeoff(db, dep, reg) : "")
    : String(opts.pcr_choice).trim();
  if (takeoff) field += ",TO=" + takeoff;
  let payLine: string;
  if (opts.pay != null && opts.pay !== "") payLine = "PAY÷" + String(opts.pay).trim();
  else {
    const payRow = db.payload["VJ" + flt];
    if (!payRow || payRow[1] === "") payLine = "PAY÷9999";
    else payLine = "PAY÷" + Math.trunc(parseFloat(payRow[1]) + 1000);
  }
  const lines = [
    `*÷Flight Plan - ${_num(opts.seq ?? "")}VJC${flt}- ${dep}-${arr}`,
    opt,
    `POD÷${dep}${routeQ}${altBit},TX${_num(_tx(db, ac, reg, dep))}`,
    poa,
    `RTE÷RT/${dep}${arr}${suffix}`,
    _hold(db, route, arr, String(flight.sta || ""), ac, alt1, alt2),
    "ETD÷" + utc,
    _profile(ac, fl, route in db.alt_route),
    `AIR÷$${reg.slice(0, 2)}${reg.slice(-4)}/`,
    "CRZ÷CI" + _ci(db, dep, arr, ac, reg),
    "OWT÷",
    payLine,
    field,
  ];
  return lines.join("\n");
}

// ----------------- crewlist rows -----------------
const _CREW_RE = /^\s*-?\s*([^()]+?)\s*\(([^)]*)\)\s*(\d{3,6})/;

function _sheetClock(v: any): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) return String(v.getUTCHours()).padStart(2, "0") + ":" + String(v.getUTCMinutes()).padStart(2, "0");
  const text = String(v).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (m) return String(parseInt(m[1], 10)).padStart(2, "0") + ":" + String(parseInt(m[2], 10)).padStart(2, "0");
  return text;
}

function _sheetDate(v: any): string {
  if (v instanceof Date) {
    const dd = String(v.getUTCDate()).padStart(2, "0");
    const mm = String(v.getUTCMonth() + 1).padStart(2, "0");
    const yy = String(v.getUTCFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  }
  return String(v ?? "").trim();
}

function _takeCrew(flight: Raw, raw: any): void {
  if (raw == null || raw === "") return;
  for (const part of String(raw).split(/\s*;\s*/)) {
    const m = _CREW_RE.exec(part);
    if (!m) continue;
    const flags = m[2].toUpperCase();
    if (flags.includes("DHD") || flags.includes("SAN") || flags.includes("SÂN") || part.includes("*")) continue;
    const ident = m[3];
    const name = m[1].split(/\s+/).filter(Boolean).join(" ");
    const person = { id: ident, name };
    const bucket = flags.includes("FO") ? flight.fos : flags.includes("CP") ? flight.captains : null;
    if (bucket === null || bucket.some((item: any) => item.id === ident)) continue;
    bucket.push(person);
  }
}

function _seatCrew(flight: Raw): void {
  const key = (person: Raw): [number, string] => {
    const n = parseInt(person.id, 10);
    return Number.isFinite(n) ? [n, person.name] : [1e9, person.name];
  };
  const cmp = (a: Raw, b: Raw) => {
    const [an, as_] = key(a), [bn, bs] = key(b);
    if (an !== bn) return an - bn;
    return as_ < bs ? -1 : as_ > bs ? 1 : 0;
  };
  const captains = [...(flight.captains || [])].sort(cmp);
  const fos = [...(flight.fos || [])].sort(cmp);
  flight.captains = captains;
  flight.fos = fos;
  if (captains.length) { flight.cpt_id = captains[0].id; flight.cpt_name = captains[0].name; }
  if (captains.length > 1) { flight.cpt2_id = captains[1].id; flight.cpt2_name = captains[1].name; }
  if (fos.length) { flight.fo_id = fos[0].id; flight.fo_name = fos[0].name; }
}

export function flights_from_crew_rows(rows: Raw[], startRow = 2): Raw[] {
  const flights: Raw[] = [];
  let cur: Raw | null = null;
  rows.forEach((row, offset) => {
    const rawFlt = row.FLT;
    let shown = rawFlt == null || String(rawFlt).trim() === "" ? "" : _num(rawFlt).trim();
    if (shown.endsWith(".0") && /^\d+$/.test(shown.slice(0, -2))) shown = shown.slice(0, -2);
    const digits = shown.replace(/\D/g, "");
    const flt = digits ? String(parseInt(digits, 10)) : "";
    if (flt) {
      cur = {
        row: startRow + offset, flt, flt_raw: shown,
        date: _sheetDate(row.DATE),
        reg: String(row.REG || "").trim().toUpperCase(),
        ac: _num(row.AC).trim(),
        dep: String(row.DEP || "").trim().toUpperCase(),
        arr: String(row.ARR || "").trim().toUpperCase(),
        sta: _sheetClock(row.STA),
        etd: _sheetClock(row.ETD) || _sheetClock(row.STD),
        eta: _sheetClock(row.ETA),
        cpt_id: "", cpt_name: "", cpt2_id: "", cpt2_name: "", fo_id: "", fo_name: "",
        captains: [], fos: [],
      };
      flights.push(cur);
    }
    if (cur !== null) _takeCrew(cur, row.Crew);
  });
  for (const flight of flights) _seatCrew(flight);
  return flights;
}

export function public_flights(
  db: Db,
  routeTable: Raw[],
  pcrDoc: Raw | null,
  specOf?: (reg: string) => { mtow?: number; type?: string } | null,
  pickVariant?: (hint: string, mtow: number) => { id?: string } | null,
): Raw[] {
  return db.flights.map((flight) => {
    const [pcrTo, pcrP10] = pcr_weights(db, String(flight.dep || ""), String(flight.reg || ""), pcrDoc, specOf, pickVariant);
    const item: Raw = {
      id: flight.row,
      flt: _num(flight.flt),
      flt_raw: flight.flt_raw || _num(flight.flt),
      date: flight.date || "",
      reg: flight.reg || "",
      ac: _num(flight.ac),
      dep: flight.dep || "",
      arr: flight.arr || "",
      etd: flight.etd || "",
      eta: flight.eta || "",
      cpt: _person(flight.cpt_id, flight.cpt_name),
      fo: _person(flight.fo_id, flight.fo_name),
      captains: [...(flight.captains || [])],
      fos: [...(flight.fos || [])],
      utc: _utc(String(flight.etd || ""), String(db.tz[String(flight.dep || "").toUpperCase()] || "")),
      eta_utc: eta_utc_hhmm(db, flight),
      pcr_to: pcrTo,
      pcr_p10: pcrP10,
    };
    Object.assign(item, route_defaults(db, flight));
    return item;
  });
}

export function build_req(
  db: Db, items: Raw[], dsp: string | null | undefined,
  routeTable: Raw[],
  pcrTakeoff?: (db: Db, dep: string, reg: string) => string,
): string {
  const blocks: string[] = [];
  for (const item of items || []) {
    let flight = db.flight(parseInt(item.id || 0, 10));
    if (flight == null) {
      const flt = _num(item.flt);
      flight = db.flights.find((row) => _num(row.flt) === flt) || null;
    }
    if (flight == null) continue;
    flight = { ...flight };
    for (const key of ["date", "reg", "ac", "dep", "arr", "etd"]) {
      if (key in item && item[key] != null) flight[key] = item[key];
    }
    blocks.push(render_fpl(db, flight, {
      extra: item.extra ?? 0,
      seq: item.seq ?? "",
      route_q: "route_q" in item ? item.route_q : undefined,
      etp_poa: "etp_poa" in item ? item.etp_poa : undefined,
      fl: "fl" in item ? item.fl : undefined,
      talt: "talt" in item ? item.talt : undefined,
      alt1: "alt1" in item ? item.alt1 : undefined,
      alt2: "alt2" in item ? item.alt2 : undefined,
      rte: "rte" in item ? item.rte : undefined,
      rmk: "rmk" in item ? item.rmk : undefined,
      pcr_choice: "pcr_to" in item ? item.pcr_to : undefined,
      cpt_id: "cpt_id" in item ? item.cpt_id : undefined,
      cpt_name: "cpt_name" in item ? item.cpt_name : undefined,
      fo_id: "fo_id" in item ? item.fo_id : undefined,
      fo_name: "fo_name" in item ? item.fo_name : undefined,
      dsp: dsp ?? null,
      pay: "pay" in item ? item.pay : undefined,
      utc_choice: "utc" in item ? item.utc : undefined,
      routeTable,
      ...(pcrTakeoff ? { pcrTakeoff } : {}),
    }));
  }
  return blocks.join("\n\n");
}

export function req_bytes(text: string): Uint8Array {
  let body = text.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  if (body && !body.endsWith("\r\n")) body += "\r\n";
  // cp1258 ~ matches ASCII + ÷ (0xF7 in latin-1/cp1258 for division sign). Use TextEncoder
  // fallback since ÷ (U+00F7) maps to single byte 0xF7 in both cp1258 and latin1.
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body.charCodeAt(i) & 0xff;
  return out;
}
