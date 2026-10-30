// Bundled ENR 5.1 rings from the original tool's data/aip_enr/rings.json
// (Malaysia/Singapore, Vietnam, Korea, India, Thailand…), so named areas such as
// "WS(D)-44" or "WMR 226" draw without a live AIP download.
import DATA from "../data/aip_enr_rings.json";
import VERIFIED from "../data/aip_named_verified.json";

type Pt = [number, number];
const RINGS: Record<string, Pt[]> = {
  ...(DATA as unknown as { rings: Record<string, Pt[]> }).rings,
  ...Object.fromEntries(Object.entries(VERIFIED.areas).map(([key, area]) => [key, area.ring as Pt[]])),
};

const ID_RE = /\b(WS|WM|WB|VV|VT|VI|VA|VE|VO|RK|WI|WA|RP|RJ|RC|VL|Z[A-Z])\s*[-/]?\s*\(?\s*([DRPW])\s*\)?\s*-?\s*(\d{1,4}[A-Z]?)(?![A-Z0-9])/g;

function matchesFir(country: string, region: string): boolean {
  if (!region) return true;
  if (country === "RJ") return /^(RJ|RO)/.test(region);
  if (/^W[ABIM]$/.test(country)) return /^(WI|WA)/.test(country) ? /^(WI|WA)/.test(region) : /^(WM|WB)/.test(region);
  if (/^V[AEIO]$/.test(country)) return /^(VA|VE|VI|VO)/.test(region);
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
  // Bare W-/R-/D-/P- codes are country-local: never resolve them outside Japan.
  if (/^(RJ|RO)/.test(region)) {
    for (const m of blob.matchAll(/\b([WRDP])\s*-\s*(\d{1,4}[A-Z]?)(?![A-Z0-9])/g)) {
      out.add(`RJ${m[1]}${m[2]}`);
    }
  }
  return [...out];
}

/** Catalog keys of ENR areas named in NOTAM text, e.g. "WS(D)-44" → "WSD44". */
export function enrIdsInText(text: string, fir = ""): string[] {
  const out: string[] = [];
  for (const key of namedEnrIds(text, fir)) {
    // A suffix can identify a different boundary; never fall back to its parent.
    const cand = RINGS[key] ? key : "";
    if (cand && !out.includes(cand)) out.push(cand);
  }
  return out;
}

export function enrRing(key: string): Pt[] {
  return (RINGS[key] || []).map(([lat, lon]) => [lat, lon]);
}
