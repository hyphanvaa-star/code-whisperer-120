// Port of utils/parsing.py, models/attachment.py, models/crew.py, models/flight.py.
// Field names are kept snake_case exactly like the Python dataclasses.
export type Raw = Record<string, unknown>;

// ---------------- utils/parsing.py ----------------
export function parseDt(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && !(value instanceof Date)) {
    value = (value as Raw)["date"];
    if (!value) return null;
  }
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  if (typeof value !== "string") return null;
  let s = value.trim();
  // "2026-07-25 23:44:10.000000" | "2026-07-26 03:29:46+0000" | ISO
  s = s.replace(" ", "T");
  s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  s = s.replace(/\.(\d{3})\d*/, ".$1");
  if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) s += "Z";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/.test(s)) s = s.replace("Z", ":00Z");
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
export function toInt(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
}
export function toFloat(v: unknown): number | null {
  if (v == null || v === "" || typeof v === "boolean") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}
export function safeFilename(name: string, maxLen = 150): string {
  let c = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/^[ .]+|[ .]+$/g, "");
  c = c.replace(/\s+/g, " ");
  if (!c) c = "unnamed";
  if (c.length > maxLen) {
    const i = c.lastIndexOf(".");
    const stem = i > 0 ? c.slice(0, i) : "";
    const ext = i > 0 ? c.slice(i + 1) : "";
    c = stem && ext.length <= 5 ? stem.slice(0, maxLen - ext.length - 1) + "." + ext : c.slice(0, maxLen);
  }
  return c;
}
/** Python datetime.isoformat() for a UTC datetime: "2026-07-26T03:29:46+00:00". */
export function isoPy(d: Date | null | undefined): string | null {
  if (!d) return null;
  const s = d.toISOString();
  const ms = d.getUTCMilliseconds();
  return (ms ? s.replace(/\.(\d{3})Z$/, ".$1000") : s.replace(/\.\d{3}Z$/, "")).replace(/Z$/, "") + "+00:00";
}
const s = (v: unknown) => (v == null ? "" : String(v)).trim();

// ---------------- models/attachment.py ----------------
const RE_PIB = /\bPIB/i;
const RE_PIB_FILE = /^PIB[_-].*\.pdf$/i;
const RE_WX = [
  /^[A-Z]{2,3}\d+[-_][A-Z]{4}[-_][A-Z]{4}([-_].*)?\.pdf$/i,
  /^[A-Z]{2,3}\d+\s+\d{4}-\d{2}-\d{2}.*\bprint\s*\.pdf$/i,
  /_WX_/i,
];
const RE_REG_FILE = /^(?:VN-?A|A)\s*(\d{3})\s*\.pdf$/i;
const RE_SORT_PREFIX = /^(?:[Z1-9]|AAA)\s+/i;
const RE_VER_SUFFIX = /\s+(?:VER|REV)\s*\d+\s*$/i;

export const isPibFilename = (name: string) => RE_PIB_FILE.test(String(name).trim());
export const isWxFilename = (name: string) => RE_WX.some((r) => r.test(String(name).trim()));
function bareRegFilename(name: string) {
  let t = String(name ?? "").trim().replace(RE_SORT_PREFIX, "");
  let stem: string, ext: string;
  if (t.toLowerCase().endsWith(".pdf")) [stem, ext] = [t.slice(0, -4), t.slice(-4)];
  else [stem, ext] = [t, ".pdf"];
  stem = stem.replace(RE_VER_SUFFIX, "").trim();
  return `${stem}${ext}`;
}
export function regFileCode(name: string): string {
  const raw = String(name ?? "").trim();
  let m = raw.match(RE_REG_FILE);
  if (m) return m[1]!;
  const bare = bareRegFilename(raw);
  m = bare.match(RE_REG_FILE);
  if (m) return m[1]!;
  const compact = bare.toUpperCase().replace(/[^A-Z0-9]/g, "");
  m = compact.match(/^(?:VNA|A)(\d{3})PDF$/);
  return m ? m[1]! : "";
}

export class Attachment {
  id = 0;
  sector_id = 0;
  title = "";
  original_filename = "";
  file_type = "";
  attachment_type: string | null = null;
  created_on: Date | null = null;
  created_by: string | null = null;
  deleted_on: Date | null = null;
  needs_acknowledging = false;
  raw: Raw = {};

  static fromApi(d: Raw, sectorId?: number): Attachment {
    const a = new Attachment();
    a.id = toInt(d["id"]) ?? 0;
    a.sector_id = toInt(d["s_id"]) || toInt(d["sector_id"]) || sectorId || 0;
    a.title = s(d["title"]);
    a.original_filename = s(d["original_filename"]);
    a.file_type = (d["file_type"] as string) || "";
    a.attachment_type = (d["attachment_type"] as string) ?? null;
    a.created_on = parseDt(d["created_on"]);
    a.created_by = (d["created_by"] as string) || null;
    a.deleted_on = parseDt(d["deleted_on"]);
    a.needs_acknowledging = !!d["needs_acknowledging"];
    a.raw = d;
    return a;
  }
  get is_pdf() {
    return this.file_type === "application/pdf" || this.original_filename.toLowerCase().endsWith(".pdf");
  }
  get is_deleted() {
    return this.deleted_on !== null;
  }
  get is_pib() {
    return RE_PIB.test(this.original_filename) || RE_PIB.test(this.title);
  }
  get is_wx() {
    return RE_WX.some((r) => r.test(this.original_filename));
  }
  get reg_code(): string | null {
    for (const raw of [this.original_filename, this.title]) {
      const c = regFileCode(raw);
      if (c) return c;
    }
    return null;
  }
  filename(prefix = "") {
    let base = this.original_filename || this.title || `attachment_${this.id}`;
    if (!base.includes(".") && this.is_pdf) base += ".pdf";
    if (prefix) base = `${prefix}_${base}`;
    return safeFilename(base);
  }
}

// ---------------- models/crew.py ----------------
export const CAPTAIN = "Captain";
export const FIRST_OFFICER = "First Officer";
export class Crew {
  id = 0;
  sector_id = 0;
  username = "";
  forename = "";
  surname = "";
  job_name = "";
  job_dept = "";
  user_id: number | null = null;
  commander = false;
  deadheading = false;
  is_sector_accepted = false;
  sector_accepted_on: Date | null = null;
  deleted_on: Date | null = null;
  raw: Raw = {};
  static fromApi(d: Raw, sectorId?: number): Crew {
    const c = new Crew();
    const job = (d["job"] as Raw) ?? {};
    c.id = toInt(d["id"]) ?? 0;
    c.sector_id = toInt(d["sector_id"]) || sectorId || 0;
    c.username = s(d["username"]);
    c.forename = s(d["forename"]);
    c.surname = s(d["surname"]);
    c.job_name = s(job["name"]);
    c.job_dept = s(job["dept"]);
    c.user_id = toInt(d["user_id"]);
    c.commander = !!d["commander"];
    c.deadheading = !!d["deadheading"];
    c.is_sector_accepted = !!d["is_sector_accepted"];
    c.sector_accepted_on = parseDt(d["sector_accepted_on"]);
    c.deleted_on = parseDt(d["deleted_on"]);
    c.raw = d;
    return c;
  }
  get full_name() {
    return [this.forename.trim(), this.surname.trim()].filter(Boolean).join(" ");
  }
  get is_captain() {
    return this.job_name === CAPTAIN;
  }
  get is_first_officer() {
    return this.job_name === FIRST_OFFICER;
  }
  get is_flight_crew() {
    return this.job_dept === "Flight Crew";
  }
}

// ---------------- models/flight.py ----------------
const F_STR = [
  "callsign", "dep_icao", "dep_iata", "dep_name", "dest_icao", "dest_iata", "dest_name", "dest_alt1", "dest_alt2",
  "route_description", "company_route", "ac_type", "acft_type", "fleet", "fuel_units", "dispatcher",
  "released_by_name", "verified_by_name", "sector_accepted_by_name",
] as const;
const F_STR_RAW = ["fltno", "commercial_fltno", "plan_no", "eet", "desk", "status", "ofp_status", "filing_status", "slot_status", "dispatch_mode"] as const;
const F_DT = ["std", "sta", "etd", "eta", "atd", "ata", "off_blocks", "off_ground", "on_ground", "in_blocks", "plan_released_on", "verified_on"] as const;
const F_FLOAT = [
  "planned_distance", "planned_fuel", "planned_fuel_total", "total_fuel", "planned_taxi_fuel", "planned_reserve_fuel",
  "planned_alt_fuel", "planned_con_fuel", "planned_extra_fuel", "planned_takeoff_weight", "landing_weight",
  "zero_fuel_weight_limit", "tankering_fuel", "cargo",
] as const;
const F_INT = ["voyage_id", "plan_id", "pax_adults", "pax_children", "pax_infants"] as const;

type StrF = (typeof F_STR)[number] | (typeof F_STR_RAW)[number];
type DtF = (typeof F_DT)[number];
type FloatF = (typeof F_FLOAT)[number];
type IntF = (typeof F_INT)[number];

export interface Flight extends Record<StrF, string>, Record<DtF, Date | null>, Record<FloatF, number | null>, Record<IntF, number | null> {}
export class Flight {
  id = 0;
  reg = "";
  is_locked = false;
  has_ofp = false;
  needs_re_release = false;
  etops = false;
  crew_count = 0;
  attachment_count = 0;
  attachments: Attachment[] = [];
  crews: Crew[] = [];
  raw: Raw = {};

  constructor(init: Partial<Flight> = {}) {
    for (const k of [...F_STR, ...F_STR_RAW]) (this as unknown as Raw)[k] = "";
    for (const k of [...F_DT, ...F_FLOAT, ...F_INT]) (this as unknown as Raw)[k] = null;
    Object.assign(this, init);
  }

  static fromApi(d: Raw): Flight {
    const f = new Flight();
    const r = f as unknown as Raw;
    f.id = toInt(d["id"]) ?? 0;
    for (const k of F_STR) r[k] = s(d[k]);
    for (const k of F_STR_RAW) r[k] = d[k] == null || d[k] === "" ? "" : String(d[k]);
    for (const k of ["fltno", "commercial_fltno"] as const) r[k] = String(r[k]).trim();
    for (const k of F_DT) r[k] = parseDt(d[k]);
    for (const k of F_FLOAT) r[k] = toFloat(d[k]);
    for (const k of F_INT) r[k] = toInt(d[k]);
    f.reg = s(d["reg"] || d["ofp_reg"]);
    f.is_locked = !!d["is_locked"];
    f.has_ofp = !!d["hasOfp"];
    f.needs_re_release = !!d["needs_re_release"];
    f.etops = !!d["etops"];
    f.attachments = ((d["attachments"] as unknown[]) ?? [])
      .filter((a): a is Raw => !!a && typeof a === "object")
      .map((a) => Attachment.fromApi(a, f.id));
    f.crew_count = toInt(d["crew_count"]) || 0;
    f.attachment_count = toInt(d["attachment_count"]) || f.attachments.length;
    f.raw = d;
    return f;
  }

  get sector_id() {
    return this.id;
  }
  get route() {
    return `${this.dep_icao}-${this.dest_icao}`;
  }
  get is_verified() {
    return !!(this.verified_on || this.verified_by_name);
  }
  get label() {
    const day = this.std ? this.std.toISOString().slice(0, 10).replace(/-/g, "") : "nodate";
    return `${day}_${this.callsign}_${this.route}`;
  }
  get captain() {
    return this.crews.find((c) => c.is_captain) ?? null;
  }
  get first_officer() {
    return this.crews.find((c) => c.is_first_officer) ?? null;
  }
  get flight_crew() {
    return this.crews.filter((c) => c.is_flight_crew);
  }
  get pdf_attachments() {
    return this.attachments.filter((a) => a.is_pdf && !a.is_deleted);
  }
  get has_pib() {
    return this.attachments.some((a) => !a.is_deleted && a.is_pib);
  }
  get has_wx() {
    return this.attachments.some((a) => !a.is_deleted && a.is_wx);
  }
  get pib_wx_status() {
    const pib = this.has_pib, wx = this.has_wx;
    if (pib && wx) return "OK";
    if (pib) return "MISS_WX";
    if (wx) return "MISS_PIB";
    return "MISS_BOTH";
  }
  get reg_attachment() {
    return this.attachments.find((a) => !a.is_deleted && a.reg_code) ?? null;
  }
  get reg_atch_match(): boolean | null {
    const att = this.reg_attachment;
    if (!att) return null;
    const m = (this.reg || "").match(/(\d{3})\s*$/);
    return !!m && att.reg_code === m[1];
  }
  get pax_total() {
    return (this.pax_adults ?? 0) + (this.pax_children ?? 0) + (this.pax_infants ?? 0);
  }
  get audit(): Raw[] {
    return (this.raw["sector_audit"] as Raw[]) ?? [];
  }
  find_attachment(keyword: string) {
    const kw = keyword.toLowerCase();
    return this.attachments.find((a) => a.title.toLowerCase().includes(kw) || a.original_filename.toLowerCase().includes(kw)) ?? null;
  }
}
