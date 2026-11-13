// Bundled ENR 5.1 rings from the original tool's data/aip_enr/rings.json
// (Malaysia/Singapore, Vietnam, Korea, India, Thailand…), so named areas such as
// "WS(D)-44" or "WMR 226" draw without a live AIP download.
import DATA from "../data/aip_enr_rings.json";
import VERIFIED from "../data/aip_named_verified.json";
import EXTRA from "../data/aip_enr_extra.json";
import RU from "../data/aip_enr_ru.json";
import type { Geom } from "./notam_track";

type Pt = [number, number];
type VerifiedArea = { name: string; fir: string; ring: Pt[]; parts?: Pt[][]; circle?: { center: Pt; radiusNm: number }; source?: string; document?: string; effective?: string; lower?: string; upperFt?: number; activation?: string };
// Czech (LK) and Kazakhstan (UA) ENR 5.1/5.2 snapshot from the official eAIPs (see AGENTS.md).
// Russia (UH/UL/UN/UR/US/UU/UW) ENR 5.1 snapshot shares one source/document header to keep the bundle small.
const RU_AREAS = Object.fromEntries(Object.entries(RU.areas as unknown as Record<string, VerifiedArea>)
  .map(([key, area]) => [key, { source: RU.source, document: RU.document, ...area }]));
const AREAS: Record<string, VerifiedArea> = { ...(VERIFIED.areas as unknown as Record<string, VerifiedArea>), ...(EXTRA.areas as unknown as Record<string, VerifiedArea>), ...RU_AREAS };
const RINGS: Record<string, Pt[]> = {
  ...(DATA as unknown as { rings: Record<string, Pt[]> }).rings,
  ...Object.fromEntries(Object.entries(AREAS).filter(([, area]) => area.ring.length >= 3).map(([key, area]) => [key, area.ring])),
};

const ID_RE = /\b(WS|WM|WB|VV|VT|VI|VA|VE|VO|RK|WI|WA|RP|RJ|RC|VL|UA|LK|UH|UL|UN|UR|US|UU|UW|Z[A-Z])\s*[-/]?\s*\(?\s*([DRPW])\s*\)?\s*-?\s*(\d{1,4}[A-Z]?)(?![A-Z0-9])/g;
const NAMED = Object.entries(AREAS).filter(([key]) => !/^\w{2}[DRPW]\d/.test(key) && !/^LKT[RS]A\d/.test(key)).map(([key, area]) => ({
  key, country: area.fir.slice(0, 2),
  pattern: new RegExp(`(?<![A-Z0-9])${area.name.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![A-Z0-9])`),
}));

const RU_PREFIX = /^U[HLNRSUW]$/;
const RU_FIR = /^U[EHILNORSUW]/;

function matchesFir(country: string, region: string): boolean {
  if (!region) return true;
  if (country === "RJ") return /^(RJ|RO)/.test(region);
  if (/^W[ABIM]$/.test(country)) return /^(WI|WA)/.test(country) ? /^(WI|WA)/.test(region) : /^(WM|WB)/.test(region);
  if (/^V[AEIO]$/.test(country)) return /^(VA|VE|VI|VO)/.test(region);
  // Russian area prefixes are subregions that span several FIR codes (UN* also covers UIII…).
  if (RU_PREFIX.test(country)) return RU_FIR.test(region);
  return region.startsWith(country);
}

/** Resolve spelling separately from boundary availability; unknown areas stay unresolved. */
export function namedEnrIds(text: string, fir = ""): string[] {
  const out = new Set<string>();
  const blob = String(text || "").toUpperCase();
  const region = fir.trim().toUpperCase();
  for (const m of blob.matchAll(ID_RE)) {
    const country = m[1], kind = m[2];
    if (kind === "W" && country !== "RJ") continue;
    if (!matchesFir(country, region)) continue;
    out.add(`${country}${kind}${m[3]}`);
  }
  // Czech TRA/TSA: "LKTRA35", "LKTSA 21", "TSA21" inside LKAA.
  if (!region || region.startsWith("LK")) {
    for (const m of blob.matchAll(/\b(?:LK\s*)?(TRA|TSA)\s*-?\s*(\d{1,3}[A-Z]?)(?![A-Z0-9])/g)) {
      if (region || /\bLK\s*T[RS]A/.test(m[0])) out.add(`LK${m[1]}${m[2]}`);
    }
  }
  // Korea ENR 5.2 MOA / ENR 5.3 CATA: "MOA 2H", "RK MOA-2H", "CATA 4A" inside RKRR (or with explicit RK prefix).
  if (!region || region.startsWith("RK")) {
    for (const m of blob.matchAll(/\b(RK\s*)?(MOA|CATA)\s*[-/]?\s*(\d{1,3}[A-Z]?)(?![A-Z0-9])/g)) {
      if (region || m[1]) out.add(`${m[2]}${m[3]}`);
    }
  }
  // Bare W-/R-/D-/P- codes are country-local: never resolve them outside Japan.
  if (/^(RJ|RO)/.test(region)) {
    for (const m of blob.matchAll(/\b([WRDP])\s*-\s*(\d{1,4}[A-Z]?)(?![A-Z0-9])/g)) {
      out.add(`RJ${m[1]}${m[2]}`);
    }
  }
  // Published names without numeric IDs also require an explicit country scope.
  for (const {key, country, pattern} of NAMED) {
    if (region && matchesFir(country, region) && pattern.test(blob)) out.add(key);
  }
  return [...out];
}

/** Catalog keys of ENR areas named in NOTAM text, e.g. "WS(D)-44" → "WSD44". */
export function enrIdsInText(text: string, fir = ""): string[] {
  const out: string[] = [];
  for (const key of namedEnrIds(text, fir)) {
    // A suffix can identify a different boundary; never fall back to its parent.
    const cand = RINGS[key] || AREAS[key]?.circle ? key : "";
    if (cand && !out.includes(cand)) out.push(cand);
  }
  return out;
}

export function enrRing(key: string): Pt[] {
  return (RINGS[key] || []).map(([lat, lon]) => [lat, lon]);
}

/** Keep published circles as circles, not fabricated straight-edge polygons. */
export function enrGeoms(key: string): Geom[] {
  const area = AREAS[key];
  if (area?.parts?.length) return area.parts.filter(r => r.length >= 3).map((ring, i) => ({ name: `${key}${area.parts!.length > 1 ? ` P${i + 1}` : ""}`, shape: "polygon" as const, ring: ring.map(([a, b]) => [a, b] as Pt), source: "aip" }));
  const circle = area?.circle;
  if (circle) return [{ name: key, shape: "circle", ring: [], lat: circle.center[0], lon: circle.center[1], radius_nm: circle.radiusNm, source: "aip" }];
  const ring = enrRing(key);
  return ring.length >= 3 ? [{ name: key, shape: "polygon", ring, source: "aip" }] : [];
}

/** Database reads the same catalogue as NOTAM matching; no independent inventory. */
export function enrCatalogue() {
  const countries: Record<string, [string, string]> = {
    VV: ["VN", "Việt Nam"], RK: ["KR", "Hàn Quốc"], VT: ["TH", "Thái Lan"],
    WM: ["MY", "Malaysia"], WB: ["MY", "Malaysia"], WS: ["SG", "Singapore"],
    VI: ["IN", "Ấn Độ"], VA: ["IN", "Ấn Độ"], VE: ["IN", "Ấn Độ"], VO: ["IN", "Ấn Độ"],
    RP: ["PH", "Philippines"],
    RJ: ["JP", "Nhật Bản"], RC: ["TW", "Đài Loan"], VL: ["LA", "Lào"],
    WI: ["ID", "Indonesia"], WA: ["ID", "Indonesia"],
    UA: ["KZ", "Kazakhstan"], LK: ["CZ", "Cộng hoà Séc"],
    UH: ["RU", "Nga"], UL: ["RU", "Nga"], UN: ["RU", "Nga"], UR: ["RU", "Nga"],
    US: ["RU", "Nga"], UU: ["RU", "Nga"], UW: ["RU", "Nga"],
  };
  return [...new Set([...Object.keys(RINGS), ...Object.keys(AREAS)])].sort().flatMap(id => {
    const geoms = enrGeoms(id);
    if (!geoms.length) return [];
    const area = AREAS[id];
    const korean = /^(MOA|CATA)\d/.test(id);
    const country = korean ? countries.RK : countries[id.slice(0, 2)] || [/^Z/.test(id) ? "CN" : "OTHER", /^Z/.test(id) ? "Trung Quốc" : "Khác"];
    return [{ id, countryCode: country[0], country: country[1], name: area?.name || id,
      fir: area?.fir || (korean ? "RKRR" : ""), source: area?.source || "", document: area?.document || "",
      effective: area?.effective || "", lower: area?.lower || "", upperFt: area?.upperFt ?? null,
      activation: area?.activation || "", geometry: geoms[0] }];
  });
}
