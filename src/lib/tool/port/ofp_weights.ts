// Port of api/ofp.py — PDF-text weight/flytime parser used by get_weights_bulk.
// Only the parsing portion (no network, no cache, no threads).

export const MARGIN_KG = Number(process.env["FLITEBRIEF_MARGIN_KG"] ?? "1000");

const _CACHE_SCHEMA_VERSION = 10;

/** FIRs crossed, read from the ATC FPL item 18 `EET/` list inside the OFP (e.g. EET/VLVT0035 VVHN0110). null = no FPL found. */
export function fplFirs(text: string): string[] | null {
  const fpl = /\(FPL-[\s\S]*?\)/.exec(text || "");
  if (!fpl) return null;
  const body = fpl[0].replace(/\s+/g, " ");
  const eet = /\bEET\/((?:\s*[A-Z]{4}\d{4})+)/.exec(body);
  if (!eet) return [];
  return [...new Set([...eet[1]!.matchAll(/([A-Z]{4})\d{4}/g)].map((m) => m[1]!))];
}

// "PLD 15000 KG ... DOW 42913" — cặp giá trị thực tế + giới hạn trên cùng một dòng
const _ROW = /^[ \t]*(PLD|ZFW|TOW|LWT)[ \t]+(\d+)[ \t]*(?:KG|KGS)?.*?\b(DOW|MZFW|MTOW|MLWT)[ \t]+(\d+)/gim;
// Trang 1 có "EST PLD 15000" — dùng làm dự phòng nếu khối trang 2 thiếu
const _EST_PLD = /\bEST[ \t]+PLD[ \t]+(\d+)/i;
// Planned flight level phải lấy đúng dòng route
const _ROUTE_FL = /^[ \t]*ROUTE[ \t]+(?:\S+[ \t]+)?FL[ \t]*(\d{2,3})\b[ \t]+CRZ/im;
const _TALT = /\bTALT\/([A-Z]{4})\b/;
const _TAKEOFF_ALT = /TAKE[ \t]*OFF[ \t]+ALT(?:N|ERNATE)?\b(?:[ \t]*[:=][ \t]*|[ \t]+)([A-Z]{4})\b/i;

const _EXTRA = /^[ \t]*EXTRA[ \t]+(\d{1,6})[ \t]+(\d{1,2}):([0-5]\d)\b/im;
// Dòng BLOCK trên CFP: "BLOCK  13874  4:23" — kg rồi giờ:phút.
const _BLOCK_FUEL = /^[ \t]*BLOCK(?:[ \t]+FUEL)?[ \t]+(\d{3,6})(?:[ \t]+(\d{1,2}):([0-5]\d))?\b/im;
// Dòng đầu OFP: "CFP 7843 VJC869 RKPK TO VVTS …" — số CFP phải khớp gantts plan_no.
const _CFP_NO = /^[ \t]*CFP[ \t]+(\d+)\b/im;

const _MAX_PAGES = 4; // khối trọng lượng nằm ở trang 2; đọc 4 trang là dư

// TRIP TIME  4.13  = 4 giờ 13 phút (không phải 4,13 giờ thập phân).
const _TRIP_TIME = /^[ \t]*TRIP[ \t]+TIME[ \t]+(\d{1,2})\.(\d{2})\b/im;
// Dòng nhiên liệu TRIP: "TRIP  12584   4:13" — dự phòng khi thiếu nhãn TRIP TIME.
const _TRIP_FUEL_TIME = /^[ \t]*TRIP[ \t]+\d+[ \t]+(\d{1,2}):(\d{2})\b/im;
// ETP RKPK/RKPC … 00.17/00.11 — số sau dấu / là thời gian diversion (phút).
const _ETP_ROW = /^[ \t]*ETP\d*[ \t]+([A-Z]{4}\/[A-Z]{4})\b[^\n]*?(\d{1,2})\.(\d{2})\/(\d{1,2})\.(\d{2})[ \t]*$/gim;
const _ETP_CONT = /^[ \t]*([A-Z]{4}\/[A-Z]{4})[ \t]+\d{3,4}\/\d{3,4}\b[^\n]*?(\d{1,2})\.(\d{2})\/(\d{1,2})\.(\d{2})[ \t]*$/gim;
// TRIP TIME  8.13   CI 26     EDTO FLIGHT          NO / 120MIN
const _EDTO_MIN = /\bEDTO[ \t]+FLIGHT\b[^\n]{0,48}?(\d{2,3})[ \t]*MIN/i;
// ALT1 VVTS/SGN … TIME  00.32
const _ALT_FLY = /^[ \t]*ALT([12])[ \t]+([A-Z]{4})\/[A-Z]{3}\b[^\n]*?\bTIME[ \t]+(\d{1,2})\.(\d{2})\b/gim;
// ROUTE RES 3PCT          377   0:09
const _ROUTE_RES = /^[ \t]*ROUTE[ \t]+RES[ \t]+(\d)PCT[ \t]+(\d+)[ \t]+(\d{1,2}):(\d{2})\b/im;
// ERA VOHS … TIME 0.22
const _ERA_HDR = /^[ \t]*ERA[ \t]+DIVERT\b/im;
const _ERA_DATA = /^[ \t]*([A-Z]{4})[ \t]+[NS]\d+\.\d+[ \t]+\S+[ \t]+\S+[ \t]+\S+[ \t]+\S+[ \t]+\S+[ \t]+(\d{1,2})\.(\d{2})\b/im;
const _ERA_OPS = /THE ENROUTE ALTERNATE(?:[ \t]+([A-Z]{4}))?[ \t]+DOES NOT MEET AIR OPS REQUIREMENTS/i;

const _FIELDS: Array<[keyof Weights, string]> = [
  ["pld", "PLD"],
  ["dow", "DOW"],
  ["zfw", "ZFW"],
  ["mzfw", "MZFW"],
  ["tow", "TOW"],
  ["mtow", "MTOW"],
  ["lwt", "LWT"],
  ["mlwt", "MLWT"],
];

export class OfpError extends Error {}

export class Weights {
  sector_id: number;
  pld: number | null = null;
  dow: number | null = null;
  zfw: number | null = null;
  mzfw: number | null = null;
  tow: number | null = null;
  mtow: number | null = null;
  lwt: number | null = null;
  mlwt: number | null = null;
  // Planned route flight level từ đúng dòng ``ROUTE ... FLxxx CRZ TEMP``.
  planned_fl: number | null = null;
  // Nguyên dòng ROUTE đã parse ra planned_fl — để bằng chứng minh bạch.
  planned_fl_line: string | null = null;
  // Takeoff alternate dạng ICAO 4 ký tự. null = OFP không ghi.
  takeoff_alt: string | null = null;
  extra_fuel: number | null = null;
  extra_time: string | null = null;
  block_fuel: number | null = null;
  trip_time_min: number | null = null;
  etps: Array<{ pair: string; min: number }> = [];
  edto_min: number | null = null;
  alt1_icao: string | null = null;
  alt1_time_min: number | null = null;
  alt2_icao: string | null = null;
  alt2_time_min: number | null = null;
  route_res_pct: number | null = null;
  route_res_min: number | null = null;
  route_res_kg: number | null = null;
  era_icao: string | null = null;
  era_time_min: number | null = null;
  era_ops_fail = false;
  cache_schema: number = _CACHE_SCHEMA_VERSION;
  pdf_sha: string | null = null;
  plan_no: string | null = null;
  firs: string[] | null = null;

  constructor(sector_id: number) {
    this.sector_id = sector_id;
  }

  get tow_margin(): number | null {
    if (this.tow === null || this.mtow === null) return null;
    return this.mtow - this.tow;
  }

  get lwt_margin(): number | null {
    if (this.lwt === null || this.mlwt === null) return null;
    return this.mlwt - this.lwt;
  }

  get zfw_margin(): number | null {
    if (this.zfw === null || this.mzfw === null) return null;
    return this.mzfw - this.zfw;
  }

  get ezfw_ok(): boolean | null {
    if (this.zfw === null || this.mzfw === null) return null;
    return this.zfw < this.mzfw;
  }

  get tow_status(): string {
    return statusOf(this.tow_margin);
  }

  get lwt_status(): string {
    return statusOf(this.lwt_margin);
  }

  get ok(): boolean {
    return this.tow !== null && this.mtow !== null;
  }

  toDict(): Record<string, unknown> {
    const d: Record<string, unknown> = {
      sector_id: this.sector_id,
      pld: this.pld,
      dow: this.dow,
      zfw: this.zfw,
      mzfw: this.mzfw,
      tow: this.tow,
      mtow: this.mtow,
      lwt: this.lwt,
      mlwt: this.mlwt,
      planned_fl: this.planned_fl,
      planned_fl_line: this.planned_fl_line,
      takeoff_alt: this.takeoff_alt,
      extra_fuel: this.extra_fuel,
      extra_time: this.extra_time,
      block_fuel: this.block_fuel,
      trip_time_min: this.trip_time_min,
      etps: this.etps,
      edto_min: this.edto_min,
      alt1_icao: this.alt1_icao,
      alt1_time_min: this.alt1_time_min,
      alt2_icao: this.alt2_icao,
      alt2_time_min: this.alt2_time_min,
      route_res_pct: this.route_res_pct,
      route_res_min: this.route_res_min,
      route_res_kg: this.route_res_kg,
      era_icao: this.era_icao,
      era_time_min: this.era_time_min,
      era_ops_fail: this.era_ops_fail,
      cache_schema: this.cache_schema,
      pdf_sha: this.pdf_sha,
      plan_no: this.plan_no,
      firs: this.firs,
    };
    d["tow_margin"] = this.tow_margin;
    d["lwt_margin"] = this.lwt_margin;
    d["zfw_margin"] = this.zfw_margin;
    d["ezfw_ok"] = this.ezfw_ok;
    d["tow_status"] = this.tow_status;
    d["lwt_status"] = this.lwt_status;
    d["flytime"] = flytimeVerdicts(this);
    return d;
  }
}

export function statusOf(margin: number | null): string {
  if (margin === null) return "NA";
  if (margin < 0) return "OVER";
  if (margin === 0) return "AT_LIMIT";
  if (margin <= MARGIN_KG) return "MARGIN";
  return "OK";
}

function hhmmMin(hh: string | number, mm: string | number): number {
  return Number(hh) * 60 + Number(mm);
}

function fmtMin(n: number): string {
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function fmtTrip(n: number): string {
  return `${Math.floor(n / 60)}h${String(n % 60).padStart(2, "0")}p`;
}

interface Cell {
  ok: boolean | null;
  detail: string;
  tip: string;
  blink: string[];
  nil: boolean;
}

function cell(ok: boolean | null, detail = "", tip = "", blink: string[] | null = null, nil = false): Cell {
  return { ok, detail, tip, blink: blink ?? [], nil: Boolean(nil) };
}

function fillFlytime(w: Weights, text: string): void {
  const trip = _TRIP_TIME.exec(text || "");
  if (trip) {
    w.trip_time_min = hhmmMin(trip[1]!, trip[2]!);
  } else {
    const fuel = _TRIP_FUEL_TIME.exec(text || "");
    if (fuel) w.trip_time_min = hhmmMin(fuel[1]!, fuel[2]!);
  }

  const edto = _EDTO_MIN.exec(text || "");
  if (edto) {
    const mins = Number(edto[1]);
    if (mins === 120 || mins === 180) w.edto_min = mins;
  }

  const etps: Array<{ pair: string; min: number }> = [];
  const seen = new Set<string>();
  function addEtp(pair: string, dh: string, dm: string) {
    const key = pair.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    etps.push({ pair: key, min: hhmmMin(dh, dm) });
  }
  _ETP_ROW.lastIndex = 0;
  for (const m of (text || "").matchAll(_ETP_ROW)) {
    addEtp(m[1]!, m[4]!, m[5]!);
  }
  _ETP_CONT.lastIndex = 0;
  for (const m of (text || "").matchAll(_ETP_CONT)) {
    addEtp(m[1]!, m[4]!, m[5]!);
  }
  w.etps = etps;

  _ALT_FLY.lastIndex = 0;
  for (const m of (text || "").matchAll(_ALT_FLY)) {
    const n = m[1]!;
    const icao = m[2]!;
    const mins = hhmmMin(m[3]!, m[4]!);
    const code = icao.toUpperCase();
    if (n === "1") {
      w.alt1_icao = code;
      w.alt1_time_min = mins;
    } else {
      w.alt2_icao = code;
      w.alt2_time_min = mins;
    }
  }

  const res = _ROUTE_RES.exec(text || "");
  if (res) {
    w.route_res_pct = Number(res[1]);
    w.route_res_kg = Number(res[2]);
    w.route_res_min = hhmmMin(res[3]!, res[4]!);
  }

  const ops = _ERA_OPS.exec(text || "");
  if (ops) {
    w.era_ops_fail = true;
    if (ops[1]) w.era_icao = ops[1].toUpperCase();
  }
  const hdr = _ERA_HDR.exec(text || "");
  if (hdr) {
    const blob = (text || "").slice(hdr.index + hdr[0].length, hdr.index + hdr[0].length + 280);
    const row = _ERA_DATA.exec(blob);
    if (row) {
      w.era_icao = row[1]!.toUpperCase();
      w.era_time_min = hhmmMin(row[2]!, row[3]!);
    }
  }

  const block = _BLOCK_FUEL.exec(text || "");
  if (block) w.block_fuel = Number(block[1]);
}

function etpCap(w: Weights): number {
  if (w.edto_min === 120 || w.edto_min === 180) return w.edto_min;
  return 60;
}

export function flytimeVerdicts(w: Weights): Record<string, unknown> {
  const trip = w.trip_time_min;
  const etps = [...(w.etps || [])];
  const cap = etpCap(w);
  const over = etps.filter((e) => Number(e.min || 0) > cap);
  const capLab = w.edto_min === 120 || w.edto_min === 180 ? `EDTO ${cap}MIN` : "60p";
  let etp: Cell;
  if (over.length) {
    const worst = over.reduce((a, b) => (Number(b.min) > Number(a.min) ? b : a));
    const tip = etps
      .map((e) => `ETP ${e.pair} diversion ${e.min}p` + (Number(e.min) > cap ? `  > ${cap}p` : ""))
      .join("\n");
    etp = cell(false, `${worst.pair} ${worst.min}p`, `Diversion ETP phải ≤ ${cap}p (${capLab}).\n` + tip);
  } else if (trip !== null && trip > 120 && !etps.length) {
    etp = cell(false, "thiếu ETP", `TRIP TIME ${fmtTrip(trip)} > 2h — OFP phải có ít nhất 1 ETP.`);
  } else if (etps.length) {
    const mx = Math.max(...etps.map((e) => Number(e.min)));
    let tip = etps.map((e) => `ETP ${e.pair} diversion ${e.min}p`).join("\n");
    if (w.edto_min === 120 || w.edto_min === 180) {
      tip = `EDTO ${w.edto_min}MIN — diversion ≤ ${cap}p.\n` + tip;
    }
    etp = cell(true, `${etps.length} ETP · max ${mx}p`, tip);
  } else if (trip !== null) {
    etp = cell(true, "nil", `TRIP TIME ${fmtTrip(trip)} ≤ 2h — không có ETP, không bắt buộc.`, null, true);
  } else {
    etp = cell(null, "", "OFP chưa đọc được TRIP TIME / ETP.", null, true);
  }

  const a1 = w.alt1_icao;
  const t1 = w.alt1_time_min;
  const a2 = w.alt2_icao;
  const t2 = w.alt2_time_min;
  const bits: string[] = [];
  if (a1 && t1 !== null) bits.push(`ALT1 ${a1} ${t1}p`);
  if (a2 && t2 !== null) bits.push(`ALT2 ${a2} ${t2}p`);
  const ev = bits.length ? bits.join("\n") : "OFP không có dòng ALT1 / ALT2.";
  const blink: string[] = [];
  const reasons: string[] = [];
  let alt: Cell;
  if (t1 === null) {
    blink.push("alt1");
    reasons.push("Chuyến phải có ít nhất 1 alternate (ALT1).");
  } else {
    if (t1 > 60) {
      blink.push("alt1");
      reasons.push(`ALT1 ${t1}p quá 60p.`);
    }
    if (t2 !== null && t2 > 60) {
      blink.push("alt2");
      reasons.push(`ALT2 ${t2}p quá 60p.`);
    }
    if (t2 !== null && t1 < t2) {
      if (!blink.includes("alt1")) blink.push("alt1");
      if (!blink.includes("alt2")) blink.push("alt2");
      reasons.push(`ALT1 ${t1}p < ALT2 ${t2}p.`);
    }
  }
  if (blink.length) {
    alt = cell(false, reasons.join(" · "), [...reasons, ...(bits.length ? [ev] : [])].join("\n"), blink);
  } else if (t2 !== null) {
    alt = cell(true, `${t1}p > ${t2}p`, ev);
  } else {
    alt = cell(true, `ALT1 ${t1}p`, ev);
  }

  const pct = w.route_res_pct;
  const rmin = w.route_res_min;
  const shown = pct !== null && rmin !== null ? `${pct}PCT ${fmtMin(rmin)}` : pct !== null ? `${pct}PCT` : "";
  let cont: Cell;
  if (pct === null || rmin === null) {
    cont = cell(false, "thiếu ROUTE RES", "OFP không có dòng ROUTE RES 3PCT / 5PCT.");
  } else if (trip !== null && trip >= 180 && pct !== 3) {
    cont = cell(
      false,
      shown,
      `TRIP TIME ${fmtTrip(trip)} ≥ 3h phải là ROUTE RES 3PCT, OFP đang ${pct}PCT.`,
    );
  } else if (trip !== null && trip < 180 && pct !== 5) {
    cont = cell(
      false,
      shown,
      `TRIP TIME ${fmtTrip(trip)} < 3h phải là ROUTE RES 5PCT, OFP đang ${pct}PCT.`,
    );
  } else if (rmin < 5) {
    cont = cell(false, shown, `ROUTE RES ${pct}PCT ${fmtMin(rmin)} — số phút phải ≥ 5p.`);
  } else {
    let why = "";
    if (trip !== null) {
      why = `TRIP TIME ${fmtTrip(trip)} ` + (trip >= 180 ? "≥ 3h → 3PCT." : "< 3h → 5PCT.");
    }
    cont = cell(true, shown, why || `ROUTE RES ${shown}`);
  }

  const needEra = Boolean(w.era_ops_fail || pct === 3 || (trip !== null && trip >= 180));
  let era: Cell;
  if (w.era_ops_fail) {
    const code = w.era_icao || "ERA";
    era = cell(false, `ERA ${code} không đạt`, `THE ENROUTE ALTERNATE ${code} DOES NOT MEET AIR OPS REQUIREMENTS`);
  } else if (w.era_icao && w.era_time_min !== null) {
    if (w.era_time_min >= 60) {
      era = cell(
        false,
        `ERA ${w.era_icao} ${w.era_time_min}p`,
        `ERA TIME phải dưới 60p — OFP ${w.era_icao} ${w.era_time_min}p.`,
      );
    } else {
      era = cell(true, `ERA ${w.era_icao} ${w.era_time_min}p`, `ERA ${w.era_icao} TIME ${w.era_time_min}p.`);
    }
  } else if (needEra) {
    era = cell(false, "thiếu ERA", "Chuyến 3PCT phải có ERA (bảng ERA DIVERT PT) và TIME dưới 60p.");
  } else {
    era = cell(true, "", "5PCT — không bắt buộc ERA.");
  }

  const bad: string[] = [];
  const good: string[] = [];
  const tips: string[] = [];
  for (const part of [cont, era]) {
    if (part.tip) tips.push(part.tip);
    if (part.ok === false) {
      if (part.detail) bad.push(part.detail);
    } else if (part.detail) {
      good.push(part.detail);
    }
  }
  let rres: Cell;
  if (bad.length || cont.ok === false || era.ok === false) {
    rres = cell(false, bad.join(" · ") || "FALSE", tips.join("\n"));
  } else {
    rres = cell(true, good.join(" · "), tips.join("\n"));
  }

  return { etp, altfly: alt, rres, trip_min: trip };
}

export function parseOperationalText(text: string, sectorId = 0): Weights {
  const w = new Weights(sectorId);
  const found: Record<string, number> = {};
  _ROW.lastIndex = 0;
  for (const m of text.matchAll(_ROW)) {
    found[m[1]!.toUpperCase()] = Number(m[2]);
    found[m[3]!.toUpperCase()] = Number(m[4]);
  }

  if (!("PLD" in found)) {
    const match = _EST_PLD.exec(text);
    if (match) found["PLD"] = Number(match[1]);
  }

  for (const [attr, key] of _FIELDS) {
    (w as unknown as Record<string, number | null>)[attr as string] = key in found ? found[key]! : null;
  }

  const routeFl = _ROUTE_FL.exec(text);
  if (routeFl) {
    w.planned_fl = Number(routeFl[1]);
    const lineMatch = /^[ \t]*ROUTE[^\n]*CRZ[^\n]*/im.exec(text);
    if (lineMatch) w.planned_fl_line = lineMatch[0].split(/\s+/).filter(Boolean).join(" ");
  }

  const talt = _TALT.exec(text) || _TAKEOFF_ALT.exec(text);
  if (talt) w.takeoff_alt = talt[1]!.toUpperCase();

  const extra = _EXTRA.exec(text);
  if (extra) {
    w.extra_fuel = Number(extra[1]);
    w.extra_time = `${Number(extra[2])}:${extra[3]}`;
  }

  const cfp = _CFP_NO.exec(text);
  if (cfp) w.plan_no = cfp[1]!;

  fillFlytime(w, text);

  if (!Object.keys(found).length && w.planned_fl === null && !w.takeoff_alt) {
    throw new OfpError("không tìm thấy khối trọng lượng hoặc route FL trong OFP");
  }
  return w;
}

// --------------------------------------------------------------------------- //
// Text extraction (PDF -> text) using unpdf
// --------------------------------------------------------------------------- //

export async function ofpTextFromPdf(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Force a plain, freshly-allocated buffer: Response#arrayBuffer() under some
  // runtimes returns a buffer type pdf.js's worker bridge cannot structuredClone.
  const buf = new Uint8Array(view.length);
  buf.set(view);
  const doc = await getDocumentProxy(buf, { disableWorker: true } as Parameters<typeof getDocumentProxy>[1]);
  const { text } = await extractText(doc, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.join("\n");
}

export async function parseWeights(pdfBytes: Uint8Array | ArrayBuffer, sectorId = 0): Promise<Weights> {
  let text: string;
  try {
    text = await ofpTextFromPdf(pdfBytes);
  } catch (exc) {
    throw new OfpError(`đọc PDF lỗi: ${String(exc)}`);
  }
  return parseOperationalText(text, sectorId);
}
