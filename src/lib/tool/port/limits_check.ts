// Port of limits_check.py — full line-by-line translation. Kept close to the
// Python source so future diffs are easy to re-check.
import type { Flight } from "../core/models";
import { srEvaluate, type SrGroup, type SrRow } from "../../special-rules";

export const WARNING = "warning";
export const CRITICAL = "critical";

const normReg = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const normApt = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const ICAO_IATA: Record<string, string> = {
  VVNB: "HAN", VVTS: "SGN", VVDN: "DAD", VVCI: "HPH",
  VVCR: "CXR", VVCT: "VCA", VVCA: "VCL", VVPK: "PXU",
  VVTX: "THD", VVPQ: "PQC", VVPB: "HUI", VVBM: "BMV",
  VVVH: "VII", VVDH: "VDH", VVDL: "DLI", VVTH: "TBB",
  VVDB: "DIN", VVPC: "UIH", VVVD: "VDO", VVRG: "VKG",
  VVCM: "CAH", VVCS: "VCS",
  RKSS: "GMP", RKPC: "CJU", RKPK: "PUS", RKSI: "ICN",
  RJAA: "NRT", RJSS: "SDJ", RJTT: "HND", RJBB: "KIX",
  VHHH: "HKG", VMMC: "MFM", ZGGG: "CAN", ZSPD: "PVG",
  WMKK: "KUL", WSSS: "SIN", VTBD: "DMK", VTBS: "BKK",
  RCKH: "KHH", RCTP: "TPE", RCMQ: "RMQ", RCNN: "TNN",
  RCFN: "TTT", RCBS: "KNH", RCYU: "HUN",
  VAAH: "AMD", VLVT: "VTE",
};
export const IATA_ICAO: Record<string, string> = Object.fromEntries(Object.entries(ICAO_IATA).map(([k, v]) => [v, k]));
const VN_IATA = new Set(Object.entries(ICAO_IATA).filter(([icao]) => icao.startsWith("VV")).map(([, iata]) => iata));

function toIata(code: string): string {
  const c = normApt(code);
  if (!c) return "";
  if (c.length === 3) return c;
  if (ICAO_IATA[c]) return ICAO_IATA[c]!;
  return c.length >= 3 ? c.slice(-3) : c;
}

function codeForms(code: string): Set<string> {
  const raw = normApt(code);
  if (!raw) return new Set();
  return new Set([raw, toIata(raw)]);
}

const APT_LL: Record<string, [number, number]> = {
  VVTS: [10.82, 106.66], VVNB: [21.22, 105.81], VVDN: [16.04, 108.2],
  VVPQ: [10.17, 103.99], VVCR: [12.0, 109.22], VVCI: [20.82, 106.72],
  VVPB: [16.4, 107.7], VVVH: [18.74, 105.67], VVCT: [10.09, 105.71],
  VVPC: [13.95, 109.04], VVBM: [12.67, 108.12], VVTX: [19.9, 105.47],
  VVPK: [14.0, 108.02], VVCA: [15.4, 108.71], VVTH: [13.05, 109.33],
  VVDH: [17.51, 106.59], VVDL: [11.75, 108.37], VVDB: [21.39, 103.01],
  VVVD: [21.12, 107.41], VVRG: [9.96, 105.13], VVCM: [9.18, 105.18],
  VVCS: [8.73, 106.63],
  VHHH: [22.31, 113.91], VMMC: [22.15, 113.59], ZGGG: [23.39, 113.3],
  ZGSZ: [22.64, 113.81], ZSPD: [31.14, 121.81], ZSHC: [30.23, 120.43],
  ZSNB: [29.83, 121.46], ZBAD: [39.51, 116.41], ZBTJ: [39.12, 117.35],
  ZUCK: [29.72, 106.64],
  RCTP: [25.08, 121.23], RCKH: [22.58, 120.35], RCMQ: [24.26, 120.62],
  RCNN: [22.95, 120.21], RCFN: [22.75, 121.1], RCBS: [24.43, 118.36],
  RCYU: [24.02, 121.62],
  RKSI: [37.46, 126.44], RKSS: [37.56, 126.8], RKPK: [35.18, 128.94],
  RKPC: [33.51, 126.49], RKTU: [36.72, 127.5], RJAA: [35.76, 140.39],
  RJTT: [35.55, 139.78], RJBB: [34.43, 135.24], RJGG: [34.86, 136.81],
  RJFF: [33.59, 130.45], RJSS: [38.14, 140.92],
  WSSS: [1.36, 103.99], WMKK: [2.74, 101.71], WMKP: [5.3, 100.28],
  WMKJ: [1.64, 103.67], VTBS: [13.69, 100.75], VTBD: [13.91, 100.61],
  VTBU: [12.68, 101.0], VTSG: [8.1, 98.99], VTSP: [8.11, 98.32],
  VLVT: [17.99, 102.56], RPLL: [14.51, 121.02], RPVM: [10.31, 123.98],
  VDPP: [11.55, 104.84], VDSA: [13.37, 104.1],
  WIII: [-6.13, 106.66], WADD: [-8.75, 115.17], WADL: [-8.76, 116.28],
  WIPP: [-2.9, 104.7], WARR: [-7.38, 112.79],
  VIDP: [28.56, 77.1], VABB: [19.09, 72.87], VAAH: [23.07, 72.63],
  VOBL: [13.2, 77.71], VOHS: [17.24, 78.43], VIJP: [26.82, 75.81],
  VILK: [26.76, 80.89],
  YBBN: [-27.38, 153.12], YMML: [-37.67, 144.84], YSSY: [-33.95, 151.18],
  UUEE: [55.97, 37.41], UNBB: [53.36, 83.54], UNKL: [56.17, 92.49],
  UNNT: [55.01, 82.65], UNTT: [56.38, 85.21], UNWW: [53.81, 86.88],
  UHWW: [43.4, 132.15], UHBB: [50.42, 127.41], UHHH: [48.53, 135.19],
  UWUU: [54.56, 55.87], UWKD: [55.61, 49.28], UWWW: [53.5, 50.16],
  UACC: [51.02, 71.47], UAKK: [49.67, 73.33],
};

function airportLl(code: string): [number, number] | null {
  const c = normApt(code);
  if (!c) return null;
  if (c.length >= 4) return APT_LL[c] ?? null;
  return APT_LL[IATA_ICAO[c] ?? ""] ?? null;
}

function distanceNm(a: string, b: string): number | null {
  const p = airportLl(a), q = airportLl(b);
  if (!p || !q) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lat1, lon1] = [toRad(p[0]), toRad(p[1])];
  const [lat2, lon2] = [toRad(q[0]), toRad(q[1])];
  const h = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

function isVn(code: string): boolean {
  const c = normApt(code);
  if (!c) return false;
  if (c.length >= 4) return c.startsWith("VV");
  return VN_IATA.has(c);
}

const TALT_MAX_NM = 430.0;

function taltPlausible(ruleCode: string, f: Flight): boolean {
  const dep = f.dep_icao || f.dep_iata;
  const dist = distanceNm(ruleCode, dep);
  if (dist != null && dist > TALT_MAX_NM) return false;
  return isVn(ruleCode) === isVn(dep);
}

function parseHhmm(s: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s || "").trim());
  if (!m) return null;
  const h = parseInt(m[1]!, 10), mi = parseInt(m[2]!, 10);
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}
const mins = (t: { h: number; m: number }) => t.h * 60 + t.m;

function inSpan(hm: { h: number; m: number }, start: { h: number; m: number }, end: { h: number; m: number }): boolean {
  const minute = mins(hm), begin = mins(start), finish = mins(end);
  if (begin === finish) return true;
  if (begin < finish) return minute >= begin && minute <= finish;
  return minute >= begin || minute <= finish;
}

function curfewHit(hm: { h: number; m: number }, start: { h: number; m: number } | null, end: { h: number; m: number } | null): boolean {
  if (start && end) return inSpan(hm, start, end);
  if (start) return mins(hm) >= mins(start);
  if (end) return mins(hm) <= mins(end);
  return false;
}

const DEST_ALT_ROLES = new Set(["ALT1", "ALT2"]);
const TO_ALT_ROLES = new Set(["TALT"]);

function ofpValue(ofp: Record<string, unknown> | null | undefined, key: string): unknown {
  if (ofp == null) return null;
  return (ofp as Record<string, unknown>)[key] ?? null;
}

function takeoffAlt(ofp: Record<string, unknown> | null | undefined): string {
  return String(ofpValue(ofp, "takeoff_alt") || "").trim();
}

type AptTuple = [string, string, Set<string>];

function flightAirports(f: Flight, ofp?: Record<string, unknown> | null): AptTuple[] {
  const out: AptTuple[] = [];
  const pairs: [string, string][] = [
    ["DEP", f.dep_iata || f.dep_icao],
    ["DEST", f.dest_iata || f.dest_icao],
    ["ALT1", f.dest_alt1],
    ["ALT2", f.dest_alt2],
    ["TALT", takeoffAlt(ofp)],
  ];
  for (const [role, code] of pairs) {
    const forms = codeForms(code);
    if (forms.size) out.push([role, toIata(code), forms]);
  }
  return out;
}

function airportRow(apBy: Map<string, Record<string, unknown>>, forms: Set<string>): Record<string, unknown> | null {
  for (const form of forms) {
    const row = apBy.get(form);
    if (row) return row;
  }
  return null;
}

const isApuInop = (text: string) => {
  const v = (text || "").toUpperCase();
  return v.includes("APU") && ["INOP", "U/S", "INOPERATIVE", "UNSERVICEABLE"].some((t) => v.includes(t));
};
const isReqApu = (text: string) => {
  const v = (text || "").toUpperCase();
  return /REQ(?:UIRE[DS]?)?[^A-Z]{0,12}(APU|ACU|ASU)/.test(v) || /(APU|ACU|ASU)[^A-Z]{0,12}REQ/.test(v);
};
const noApuAirport = (limit: string) => {
  const u = (limit || "").toUpperCase();
  if (u.includes("NO APU")) return true;
  return u.includes("NO") && u.includes("APU SERVICE");
};
const airportClosed = (limit: string) => {
  const u = (limit || "").toUpperCase();
  return u.includes("CLOSED") || u.includes("RECONSTRUCTION");
};

function matchTypeToken(token: string, acType: string): boolean {
  let wanted = (token || "").toUpperCase().replace(/\s+/g, " ").trim();
  const actual = (acType || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!wanted || !actual) return false;
  wanted = wanted.replace(" TYPE", "").trim();
  if (wanted.includes("NEO") || wanted.includes("A21")) {
    return (actual.includes("321") && (actual.includes("N") || actual.includes("NEO"))) || actual.includes("A21N") || actual.includes("321N");
  }
  const compact = actual.replace(/[\s-]/g, "");
  const want = wanted.replace(/[\s-]/g, "");
  if (["333", "A333", "A330", "A332"].some((t) => want.includes(t)) || ["330", "332", "333"].includes(want)) {
    return ["A330", "A332", "A333"].some((t) => compact.includes(t)) || ["330", "332", "333"].includes(compact);
  }
  if (wanted.includes("320") && !wanted.includes("321")) {
    return (actual.includes("320") || /\b32[0A]\b/.test(actual)) && !actual.includes("321");
  }
  if (wanted.includes("321") && !wanted.includes("NEO")) return actual.includes("321");
  return actual.includes(wanted);
}

const onlyOpsType = (limit: string) => (limit || "").toUpperCase().includes("ONLY OPS");

const RE_TO_ALT = /TAKE[\s-]?OFF\s+ALT(?:N|ERNATE)?|T\/O\s+ALT(?:N|ERNATE)?/i;
const mentionsTakeoffAlt = (limit: string) => RE_TO_ALT.test(limit || "");

function altOnlyRule(limit: string): boolean {
  const u = (limit || "").toUpperCase();
  return u.includes("DESTINATION ALTERNATE") || mentionsTakeoffAlt(u);
}

function mentionsAlternate(limit: string): boolean {
  const u = (limit || "").toUpperCase();
  if (onlyOpsType(u)) return false;
  return u.includes("ALTERNATE") || u.includes("ALTN");
}

interface Warn {
  kind: string;
  text: string;
  severity: string;
  check: string;
  evidence: string;
  defect: string;
  limit: string;
}

function warning(kind: string, text: string, opts: Partial<Warn> = {}): Warn {
  return {
    kind,
    text,
    severity: opts.severity ?? WARNING,
    check: opts.check ?? "",
    evidence: opts.evidence ?? "",
    defect: opts.defect ?? "",
    limit: opts.limit ?? "",
  };
}

const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
const parseNumber = (raw: string) => parseFloat(raw.replace(/[\s,]/g, ""));
function weightKg(raw: string, unit: string): number {
  let value = parseNumber(raw);
  if (unit.toUpperCase().startsWith("T")) value *= 1000;
  return Math.round(value);
}

const ALTITUDE_LIMIT =
  /(?:FLIGHT\s+)?(?:ALTITUDE|FLIGHT\s+LEVEL).*?(?:LIMITED\s+TO|MAX(?:IMUM)?(?:\s+IS)?|NOT\s+EXCEED(?:ING)?)\s*(?:(\d[\d\s,]{2,9})\s*FT\b|(?:FL\s*)?(\d{2,3})\b)/gi;
const WEIGHT_LIMIT =
  /(?:(MAX(?:IMUM)?(?:\s+IS)?)\s+)?(TOW|MTOW|TAKE[ -]?OFF\s+WEIGHT|LWT|LW|MLWT|LANDING\s+WEIGHT|ZFW|MZFW|ZERO\s+FUEL\s+WEIGHT|PLD|PAYLOAD)\b(?:\s+(?:LIMIT(?:ED)?\s+TO|MAX(?:IMUM)?(?:\s+IS)?|NOT\s+EXCEED(?:ING)?|<=|IS))?\s*(\d+(?:[\s,]\d{3})*(?:\.\d+)?)\s*(KG|KGS|T|TON|TONNE|TONNES)\b/gi;

function constraintCandidates(limit: string): boolean {
  ALTITUDE_LIMIT.lastIndex = 0;
  WEIGHT_LIMIT.lastIndex = 0;
  return ALTITUDE_LIMIT.test(limit || "") || WEIGHT_LIMIT.test(limit || "");
}

const FUEL_PENALTY =
  /FUEL\s+PENALT(?:Y|IES)|(?:PERFORMANCE|FLIGHT\s+MANUAL)\s+PENALT(?:Y|IES)|PENALT(?:Y|IES)\s+(?:ARE|IS)\s+APPLIED|INCREASE[DS]?\s+(?:IN\s+)?FUEL\s+(?:CONSUMPTION|BURN|FLOW)|FUEL\s+(?:CONSUMPTION|BURN|FLOW)\s+(?:IS\s+|ARE\s+)?INCREASE[DS]?|HIGHER\s+FUEL\s+(?:CONSUMPTION|BURN|FLOW)|FUEL\s+(?:CONSUMPTION|BURN)\s+PENALT(?:Y|IES)|FUEL\s+PLANNING/i;

function extraFuelNote(f: Flight): string {
  const extra = f.planned_extra_fuel;
  const units = (f.fuel_units || "KG").trim();
  if (!extra) return "kế hoạch CHƯA có EXTRA";
  return `kế hoạch đang có EXTRA ${fmtInt(Math.round(extra))} ${units}`;
}

export interface LimitsData {
  aircraft?: Array<Record<string, unknown>>;
  airports?: Array<Record<string, unknown>>;
  curfew?: Array<Record<string, unknown>>;
  special?: Array<Record<string, unknown>>;
  acgroups?: SrGroup[];
}

export function needsOfpLimitCheck(f: Flight, limits: LimitsData | null | undefined): boolean {
  if (!limits) return false;
  const reg = normReg(f.reg);
  const aircraft = limits.aircraft ?? [];
  if (
    aircraft.some(
      (row) => row && normReg(String(row["reg"] || "")) === reg && constraintCandidates(String(row["limit"] || "")),
    )
  )
    return true;
  const acType = (f.ac_type || f.acft_type || "").trim();
  const special = limits.special ?? [];
  return special.some(
    (row) =>
      row &&
      mentionsAlternate(String(row["limit"] || "")) &&
      taltPlausible(String(row["code"] || ""), f) &&
      matchTypeToken(String(row["reg"] || "").trim(), acType),
  );
}

function evaluateOfpLimit(limit: string, ofp: Record<string, unknown> | null | undefined): [string, string[]] {
  let severity = WARNING;
  const evidence: string[] = [];

  if (ofp == null) {
    if (constraintCandidates(limit)) evidence.push("Chưa check OFP — bấm “Check OFP live” để so độ cao/trọng lượng");
    return [severity, evidence];
  }

  ALTITUDE_LIMIT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALTITUDE_LIMIT.exec(limit || ""))) {
    const plannedFl = ofpValue(ofp, "planned_fl") as number | null;
    if (plannedFl == null) {
      evidence.push("OFP có nhưng không đọc được dòng ROUTE … FL … CRZ");
      continue;
    }
    const maxFeet = m[1] ? Math.round(parseNumber(m[1])) : parseInt(m[2]!, 10) * 100;
    const actualFeet = Math.round(plannedFl) * 100;
    const operator = actualFeet > maxFeet ? ">" : "≤";
    const source = ofpValue(ofp, "planned_fl_line");
    evidence.push(
      `OFP ROUTE FL${Math.round(plannedFl)} = ${fmtInt(actualFeet)} FT ${operator} giới hạn ${fmtInt(maxFeet)} FT` +
        (source ? `  ← dòng: ${source}` : ""),
    );
    if (actualFeet > maxFeet) severity = CRITICAL;
  }

  const keyByLabel: Record<string, string> = {
    TOW: "tow", MTOW: "tow", "TAKEOFF WEIGHT": "tow",
    LWT: "lwt", LW: "lwt", MLWT: "lwt", "LANDING WEIGHT": "lwt",
    ZFW: "zfw", MZFW: "zfw", "ZERO FUEL WEIGHT": "zfw",
    PLD: "pld", PAYLOAD: "pld",
  };
  WEIGHT_LIMIT.lastIndex = 0;
  while ((m = WEIGHT_LIMIT.exec(limit || ""))) {
    const hasMaxPrefix = !!m[1];
    const label = m[2]!.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const aliases: Record<string, string> = {
      TAKEOFFWEIGHT: "TAKEOFF WEIGHT",
      LANDINGWEIGHT: "LANDING WEIGHT",
      ZEROFUELWEIGHT: "ZERO FUEL WEIGHT",
    };
    const canonical = aliases[label] ?? label;
    const key = keyByLabel[canonical];
    if (!key) continue;
    const actualRaw = ofpValue(ofp, key);
    const maximum = weightKg(m[3]!, m[4]!);
    if (actualRaw == null) {
      evidence.push(`OFP chưa có ${key.toUpperCase()} để so giới hạn ${fmtInt(maximum)} KG`);
      continue;
    }
    const actual = Math.round(actualRaw as number);
    const operator = actual > maximum ? ">" : "≤";
    evidence.push(`OFP ${key.toUpperCase()} ${fmtInt(actual)} KG ${operator} giới hạn ${fmtInt(maximum)} KG`);
    if (hasMaxPrefix && actual > maximum) severity = CRITICAL;
  }

  return [severity, evidence];
}

function isDomestic(f: Flight): boolean {
  return isVn(f.dep_icao || f.dep_iata) && isVn(f.dest_icao || f.dest_iata);
}

function isGeneralEdtoBan(limit: string): boolean {
  const u = (limit || "").toUpperCase();
  return (u.includes("EDTO IS NOT CONDUCTED") || u.includes("EDTO NOT CONDUCTED")) && !u.includes("BEYOND") && !u.includes("180");
}

export function checkFlightLimits(
  f: Flight,
  limits: LimitsData | null | undefined,
  ofp: Record<string, unknown> | null = null,
): Warn[] {
  if (!limits) return [];
  const warns: Warn[] = [];
  const regN = normReg(f.reg);
  const acType = (f.ac_type || f.acft_type || "").trim();
  const apts = flightAirports(f, ofp);
  const aptForms = new Set<string>();
  for (const [, , forms] of apts) for (const x of forms) aptForms.add(x);

  const aircraft = (limits.aircraft ?? []).filter((row) => row && String(row["reg"] || "").trim());
  const airports = (limits.airports ?? []).filter((row) => row && String(row["code"] || "").trim());
  const apBy = new Map<string, Record<string, unknown>>();
  for (const row of airports) {
    for (const form of codeForms(String(row["code"]))) if (!apBy.has(form)) apBy.set(form, row);
  }

  const defectHits = aircraft.filter((row) => normReg(String(row["reg"] || "")) === regN);
  for (const hit of defectHits) {
    const defect = String(hit["defect"] || "").trim();
    const limit = String(hit["limit"] || "").trim();
    const combined = `${defect}\n${limit}`;
    const baseText = `${f.reg || "?"}: ${defect || "defect"}`;

    if (isApuInop(combined) || isReqApu(combined)) {
      const apuHits: [string, string, string][] = [];
      for (const [role, code, forms] of apts) {
        const row = airportRow(apBy, forms);
        const airportLimit = String((row || {})["limit"] || "").trim();
        if (row && noApuAirport(airportLimit)) apuHits.push([role, code, airportLimit]);
      }
      if (apuHits.length) {
        const sev = isApuInop(combined) ? CRITICAL : WARNING;
        for (const [role, code, airportLimit] of apuHits) {
          const evidence = `${role} ${code}: ${airportLimit}`;
          warns.push(
            warning("defect", `${baseText} → ${evidence}` + (limit ? ` (${limit})` : ""), {
              severity: sev,
              check: "apu_airport",
              evidence,
              defect,
              limit,
            }),
          );
        }
        continue;
      }
      if (!isApuInop(combined)) continue;
      warns.push(
        warning("defect", `${baseText} — ${limit || "APU INOP"}`, {
          check: "apu",
          evidence: "Không trúng sân NO APU SERVICE trong route/alternate",
          defect,
          limit: limit || "APU INOP",
        }),
      );
      continue;
    }

    if (!limit) continue;

    let [severity, evidenceItems] = evaluateOfpLimit(limit, ofp);
    let check = evidenceItems.length ? "ofp" : "operational_limit";

    if (limit.toUpperCase().includes("OPS DOMESTIC")) {
      const domestic = isDomestic(f);
      evidenceItems.push(`Chặng ${f.dep_icao}-${f.dest_icao} ${domestic ? "là nội địa" : "không phải nội địa Việt Nam"}`);
      if (!domestic) severity = CRITICAL;
      check = "domestic";
    }

    if (isGeneralEdtoBan(limit)) {
      evidenceItems.push(`FliteBrief ETOPS/EDTO: ${f.etops ? "CÓ" : "KHÔNG"}`);
      if (f.etops) severity = CRITICAL;
      check = "edto";
    }

    if (FUEL_PENALTY.test(combined)) {
      evidenceItems.push(`Defect có fuel penalty / làm tăng tiêu thụ nhiên liệu — OFP phải cộng EXTRA fuel; ${extraFuelNote(f)}`);
      severity = CRITICAL;
      check = "fuel_penalty";
    }

    warns.push(
      warning("defect", `${baseText} — ${limit}`, {
        severity,
        check,
        evidence: evidenceItems.join("\n"),
        defect,
        limit,
      }),
    );
  }

  for (const [role, code, forms] of apts) {
    const airport = airportRow(apBy, forms);
    if (!airport) continue;
    const limit = String(airport["limit"] || "").trim();
    if (airportClosed(limit)) {
      const evidence = `${role} ${code} nằm trong kế hoạch`;
      warns.push(warning("airport", `${role} ${code}: ${limit}`, { severity: CRITICAL, check: "airport_closed", evidence, limit }));
    }
  }

  for (const row of limits.curfew ?? []) {
    if (!row) continue;
    const curForms = codeForms(String(row["code"] || ""));
    if (!curForms.size || ![...curForms].some((x) => aptForms.has(x))) continue;
    const code = toIata(String(row["code"] || ""));
    const startT = parseHhmm(String(row["start"] || row["open"] || ""));
    const endT = parseHhmm(String(row["end"] || row["close"] || row["time"] || ""));
    if (!startT && !endT) continue;
    const checks: [string, Date][] = [];
    const depForms = codeForms(f.dep_iata || f.dep_icao);
    const destForms = codeForms(f.dest_iata || f.dest_icao);
    if ([...depForms].some((x) => curForms.has(x)) && f.std) checks.push(["DEP/STD", f.std]);
    if ([...destForms].some((x) => curForms.has(x)) && f.sta) checks.push(["DEST/STA", f.sta]);
    for (const [role, alt] of [["ALT1", f.dest_alt1], ["ALT2", f.dest_alt2]] as [string, string][]) {
      if ([...codeForms(alt || "")].some((x) => curForms.has(x)) && f.sta) checks.push([`${role}/STA`, f.sta]);
    }
    const window = `${row["start"] || row["open"] || "—"}→${row["end"] || row["close"] || "—"}`;
    for (const [role, when] of checks) {
      const hm = { h: when.getUTCHours(), m: when.getUTCMinutes() };
      if (curfewHit(hm, startT, endT)) {
        const hhmm = `${String(hm.h).padStart(2, "0")}:${String(hm.m).padStart(2, "0")}`;
        const evidence = `${role} ${hhmm}Z trong ${window} UTC`;
        warns.push(
          warning("curfew", `CURFEW ${code}: ${evidence}`, {
            severity: CRITICAL,
            check: "curfew",
            evidence,
            limit: `CURFEW ${window} UTC`,
          }),
        );
      }
    }
  }

  const byRole = Object.fromEntries(apts.map(([role, code]) => [role, code]));
  for (const row of limits.special ?? []) {
    if (!row) continue;
    if (row["rule"]) {
      for (const h of srEvaluate(row as SrRow, {
        reg: f.reg, ac: acType, dep: f.dep_icao || f.dep_iata, dest: f.dest_icao || f.dest_iata,
        alt1: f.dest_alt1, alt2: f.dest_alt2, talt: byRole["TALT"], etops: !!f.etops,
      }, limits.acgroups)) {
        warns.push(warning("special", h.text, { severity: h.sev === "critical" ? CRITICAL : WARNING, check: "special", evidence: h.role, limit: String(row["limit"] || "") }));
      }
      continue;
    }
    const token = String(row["reg"] || "").trim();
    const ruleForms = codeForms(String(row["code"] || ""));
    const code = toIata(String(row["code"] || ""));
    const limit = String(row["limit"] || "").trim();
    if (!token || !ruleForms.size || ![...ruleForms].some((x) => aptForms.has(x))) continue;
    const roles = apts.filter(([, , forms]) => [...forms].some((x) => ruleForms.has(x))).map(([role]) => role);
    const upper = limit.toUpperCase();

    let violates = false;
    let reason = "";
    if (onlyOpsType(limit)) {
      violates = !matchTypeToken(token, acType);
      reason = `tàu ${acType || f.reg || "?"} không phải ${token}`;
    } else if (matchTypeToken(token, acType)) {
      if (altOnlyRule(upper)) {
        const allowed = new Set<string>();
        if (upper.includes("DESTINATION ALTERNATE")) for (const r of DEST_ALT_ROLES) allowed.add(r);
        if (mentionsTakeoffAlt(upper)) for (const r of TO_ALT_ROLES) allowed.add(r);
        const hitRoles = roles.filter((r) => allowed.has(r));
        violates = hitRoles.length > 0;
        reason = hitRoles.length ? `${code} được chọn làm ${hitRoles.join(",")}` : "";
      } else if (upper.includes("NOT OPS")) {
        violates = true;
        reason = `${code} xuất hiện ở ${roles.join(",")}`;
      } else {
        violates = true;
        reason = `${code} xuất hiện ở ${roles.join(",")}`;
      }
    }

    if (violates) {
      warns.push(warning("special", `${token} @ ${code}: ${limit}`, { severity: CRITICAL, check: "special", evidence: reason, limit }));
    }
  }

  const seen = new Set<string>();
  const unique: Warn[] = [];
  for (const w of warns) {
    const key = `${w.text}\u0000${w.severity}\u0000${w.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(w);
  }
  return unique;
}
