// Partial port of notam_check.py — ICAO/FIR normalisation, NOTAM compaction and
// the 24H filter used by /api/notam/lookup. OFP parsing, SID/STAR/RWY summaries,
// head_vi Vietnamese summariser and the full check_flights/tune_places pipeline
// (which depend on api/ofp.py, aip_sup.py and notam_track.py's geospatial engine)
// are NOT ported — out of scope for this task (see handlers/notam.server.ts report).
export const WINDOW_H = 24.0;
const ICAO_RE = /^[A-Z]{4}$/;
const PERM = new Set(["", "PERM", "UFN", "EST", "WIE", "NONE"]);

export function normIcao(raw: unknown): string {
  const code = String(raw ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return ICAO_RE.test(code) ? code : "";
}

const VVHN_AIR = new Set(["VVNB", "VVCI", "VVVD", "VVDH", "VVDB", "VVTX", "VVLK", "VVNS"]);

export function airportParentFir(icao: string, portalFir = ""): string {
  const code = normIcao(icao);
  if (!code) return normIcao(portalFir);
  if (code.startsWith("VV")) return VVHN_AIR.has(code) ? "VVHN" : "VVHM";
  if (code.startsWith("RK")) return "RKRR";
  if (code.startsWith("RJ") || code.startsWith("RO")) return "RJJJ";
  return normIcao(portalFir);
}

export function unwrapIcao(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) return payload[0] && typeof payload[0] === "object" ? (payload[0] as Record<string, unknown>) : {};
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function ident(row: Record<string, unknown>): string {
  const series = String(row.notamSeries ?? row.notam_series ?? "").trim();
  const number = String(row.notamNumber ?? row.notam_number ?? "").trim();
  let id = series && number.toUpperCase().startsWith(series.toUpperCase()) ? number : `${series}${number}`;
  const year = String(row.notamYear ?? row.notam_year ?? "").trim();
  if (year && id) id = `${id}/${year}`;
  else if (year) id = year;
  return id;
}

export function parseNotamWhen(raw: unknown, endOfDay = false): Date | null {
  let text = String(raw ?? "").trim();
  if (!text || PERM.has(text.toUpperCase())) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const normalized = text.replace(" ", "T");
    const iso = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : normalized + "Z");
    if (!Number.isNaN(iso.getTime())) return iso;
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length >= 12) {
    const y = +digits.slice(0, 4), mo = +digits.slice(4, 6) - 1, d = +digits.slice(6, 8);
    const h = +digits.slice(8, 10), mi = +digits.slice(10, 12);
    const dt = new Date(Date.UTC(y, mo, d, h, mi));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (digits.length >= 8) {
    const y = +digits.slice(0, 4), mo = +digits.slice(4, 6) - 1, d = +digits.slice(6, 8);
    const dt = new Date(Date.UTC(y, mo, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0));
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

function icaoStamp(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (PERM.has(text.toUpperCase())) return text ? "PERM" : "";
  const dt = parseNotamWhen(text);
  if (dt) {
    const p2 = (n: number) => String(n).padStart(2, "0");
    return `${dt.getUTCFullYear()}${p2(dt.getUTCMonth() + 1)}${p2(dt.getUTCDate())}${p2(dt.getUTCHours())}${p2(dt.getUTCMinutes())}`;
  }
  const digits = text.replace(/\D/g, "");
  return digits ? digits.slice(0, 12) : text;
}

function qLetters(raw: unknown): string {
  let letters = String(raw ?? "").replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.startsWith("Q")) letters = letters.slice(1);
  if (letters.length === 2) return letters;
  if (letters.length === 4) return letters.slice(0, 2);
  return "";
}

function eFieldOf(row: Record<string, unknown>): string {
  const found: string[] = [];
  for (const key of ["e_field", "eField", "notam_text", "notamText", "itemE", "item_e"]) {
    const blob = String(row[key] ?? "").trim();
    if (blob) found.push(blob);
  }
  if (!found.length) return "";
  let blob = found.reduce((a, b) => (b.length > a.length ? b : a));
  if (blob.slice(0, 2).toUpperCase() === "E)") blob = blob.slice(2).trimStart();
  return blob;
}

function qAltLabel(raw: unknown): string {
  if (raw == null) return "";
  const text = String(raw).trim().toUpperCase();
  if (!text) return "";
  const n = parseInt(text, 10);
  if (Number.isNaN(n)) return text;
  if (n <= 0) return "SFC";
  if (n >= 999) return "UNL";
  if (n >= 100) return `FL${n}`;
  return `${n * 100}FT AMSL`;
}

function fgFields(row: Record<string, unknown>): [string, string] {
  let f = String(row.f_field ?? row.fField ?? "").trim();
  let g = String(row.g_field ?? row.gField ?? "").trim();
  if (!f) f = qAltLabel(row.lower);
  if (!g) g = qAltLabel(row.upper);
  return [f, g];
}

function qLine(row: Record<string, unknown>): string {
  const qfir = String(row.qfir ?? row.icao ?? "").toUpperCase();
  const subject = String(row.subject ?? "").trim();
  const condition = String(row.condition ?? "").trim();
  let qcode = subject + condition;
  if (qcode && !qcode.toUpperCase().startsWith("Q")) qcode = "Q" + qcode;
  const parts = [
    qfir, qcode, String(row.traffic ?? ""), String(row.purpose ?? ""), String(row.scope ?? ""),
    row.lower == null ? "" : String(row.lower), row.upper == null ? "" : String(row.upper),
  ];
  let body = parts.join("/");
  const coords = String(row.coords ?? "").replace(/\s+/g, "");
  if (coords) body = `${body}/${coords}`;
  return `Q)${body}`;
}

export function formatIcaoNotam(row: Record<string, unknown>, kind = ""): string {
  const ntype = String(row.notamType ?? row.notam_type ?? kind ?? "").toUpperCase();
  const label = ntype === "F" || ntype === "FIR" ? "FIR" : "APT";
  let origin = String(row.origin_time ?? "").trim();
  if (!origin) origin = icaoStamp(row.originTime ?? row.origin_time);
  const id = ident(row);
  const subject = String(row.subject_description ?? row.subjectDescription ?? "").trim();
  const condition = String(row.condition_description ?? row.conditionDescription ?? "").trim();
  const head = [label, origin, id, subject, condition].filter(Boolean).join(" ");
  const icao = String(row.icao ?? "").toUpperCase();
  let start = icaoStamp(row.startDate ?? row.start_date);
  let end = icaoStamp(row.endDate ?? row.end_date);
  if (String(row.perm ?? "").toUpperCase() === "Y" && !end) end = "PERM";
  const abc = [icao ? `A)${icao}` : "", start ? `B)${start}` : "", end ? `C)${end}` : ""].filter(Boolean).join(" ");
  const eField = eFieldOf(row);
  const dField = String(row.d_field ?? row.dField ?? "").trim();
  const [fField, gField] = fgFields(row);
  const lines = [head, qLine(row), abc];
  if (dField) lines.push(`D)${dField}`);
  if (eField) lines.push(`E)${eField}`);
  let blob = lines.join("\n");
  const fg = [fField ? `F)${fField}` : "", gField ? `G)${gField}` : ""].filter(Boolean).join(" ");
  if (fg && !/^[ \t]*[FG]\)/im.test(blob)) lines.push(fg);
  return lines.join("\n").trim();
}

export function compactNotam(row: Record<string, unknown>, kind: string): Record<string, unknown> {
  const eField = eFieldOf(row);
  const dField = String(row.d_field ?? row.dField ?? row.itemD ?? row.schedule ?? "").trim();
  const [fField, gField] = fgFields(row);
  return {
    id: row.notamId ?? row.id ?? "",
    ident: ident(row),
    kind,
    icao: String(row.icao ?? "").toUpperCase(),
    subject: String(row.subject_description ?? row.subjectDescription ?? "").trim(),
    condition: String(row.condition_description ?? row.conditionDescription ?? "").trim(),
    e_field: eField,
    d_field: dField,
    text: formatIcaoNotam(row, kind),
    start: String(row.start_date ?? row.startDate ?? "").trim(),
    end: String(row.end_date ?? row.endDate ?? "").trim(),
    severity: Number(row.severity ?? 0) | 0,
    colour: String(row.colour ?? ""),
    coords: String(row.coords ?? "").replace(/\s+/g, ""),
    qfir: String(row.qfir ?? row.icao ?? "").toUpperCase(),
    qsubj: qLetters(row.subject),
    qcond: qLetters(row.condition),
    purpose: String(row.purpose ?? "").trim().toUpperCase(),
    scope: String(row.scope ?? "").trim().toUpperCase(),
    traffic: String(row.traffic ?? "").trim().toUpperCase(),
    lower: row.lower ?? null,
    upper: row.upper ?? null,
    f_field: fField,
    g_field: gField,
  };
}

export function notamIn24h(notam: Record<string, unknown>, now: Date = new Date()): boolean {
  const start = parseNotamWhen(notam.start);
  const end = parseNotamWhen(notam.end, true);
  const hi = new Date(now.getTime() + WINDOW_H * 3600_000);
  if (start && start > hi) return false;
  if (end && end < now) return false;
  return true;
}

export function apply24h(place: Record<string, unknown>, now: Date = new Date()): Record<string, unknown> {
  const rows = (place.notams as Record<string, unknown>[] | undefined) ?? [];
  const kept = rows.filter((row) => notamIn24h(row, now));
  return { ...place, notams_all: rows.length, notams: kept, notam_count: kept.length };
}

export function placeFromPayload(code: string, payloadIn: Record<string, unknown> | unknown[], want = ""): Record<string, unknown> {
  // FliteBrief /webapi/icaos/<icao> trả về mảng [ {airfields, firs, ...} ].
  const payload = (Array.isArray(payloadIn) ? (payloadIn[0] ?? {}) : (payloadIn ?? {})) as Record<string, unknown>;
  const airfields = (payload.airfields as Record<string, unknown>[] | undefined) ?? [];
  const firs = (payload.firs as Record<string, unknown>[] | undefined) ?? [];
  const af = airfields[0] && typeof airfields[0] === "object" ? airfields[0] : {};
  const fr = firs[0] && typeof firs[0] === "object" ? firs[0] : {};
  const miss = {
    code: normIcao(code) || String(code).toUpperCase(),
    kind: "", name: "", iata: "", fir: "", notam_count: 0, notams: [] as unknown[],
    error: "Không tìm được dữ liệu, cần trích xuất nguồn khác.", uses: [] as unknown[],
  };
  if (!Object.keys(af).length && !Object.keys(fr).length) return miss;
  const wantU = String(want ?? "").trim().toUpperCase();
  const actsFir = String(af.acts_as_fir ?? "").toUpperCase() === "Y" || String(af.acts_as_fir ?? "").toUpperCase() === "1" || String(af.acts_as_fir ?? "").toUpperCase() === "TRUE";
  const firRows = (payload.fir_notam as Record<string, unknown>[] | undefined) ?? [];
  let kind: string;
  if (wantU === "FIR" || wantU === "F") {
    if (Object.keys(fr).length) kind = "FIR";
    else if (firRows.length) kind = "FIR";
    else if (Object.keys(af).length && actsFir) kind = "FIR";
    else return { ...miss, error: `${miss.code} trên EET/ là FIR nhưng portal không có FIR.` };
  } else if (wantU === "A" || wantU === "APT") {
    if (!Object.keys(af).length) return { ...miss, error: `${miss.code} trên RALT/DEP/ARR là sân nhưng portal không có sân bay.` };
    kind = "A";
  } else {
    kind = Object.keys(fr).length && !Object.keys(af).length ? "FIR" : "A";
  }
  let meta: Record<string, unknown>, notamsRaw: unknown[], iata: string, firOf: string;
  if (kind === "FIR") {
    meta = Object.keys(fr).length ? fr : { name: String(af.alt_name ?? "").trim() || `FIR ${miss.code}`, iata: "" };
    notamsRaw = firRows.length ? firRows : actsFir ? ((payload.airfield_notam as unknown[]) ?? []) : [];
    iata = "";
    firOf = miss.code;
  } else {
    meta = af;
    notamsRaw = (payload.airfield_notam as unknown[]) ?? [];
    iata = String(meta.iata ?? "").trim();
    firOf = airportParentFir(miss.code, String(af.fir ?? ""));
  }
  const notams = (notamsRaw || []).filter((r): r is Record<string, unknown> => !!r && typeof r === "object").map((row) => compactNotam(row, kind));
  return {
    code: miss.code, kind, name: String(meta.name ?? "").trim(), iata, fir: firOf,
    notam_count: notams.length, notams, error: "", uses: [],
  };
}

const CODE_SPLIT = /[^A-Za-z]+/;

export function parseLookupCodes(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of String(raw ?? "").toUpperCase().split(CODE_SPLIT)) {
    const code = normIcao(tok);
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push(code);
    }
  }
  return out;
}
