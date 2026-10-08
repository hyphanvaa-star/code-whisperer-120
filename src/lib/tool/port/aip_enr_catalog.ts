// Bundled ENR 5.1 rings from the original tool's data/aip_enr/rings.json
// (Malaysia/Singapore, Vietnam, Korea, India, Thailand…), so named areas such as
// "WS(D)-44" or "WMR 226" draw without a live AIP download.
import DATA from "../data/aip_enr_rings.json";

type Pt = [number, number];
const RINGS = (DATA as { rings: Record<string, Pt[]> }).rings;

const ID_RE = /\b(WS|WM|WB|VV|VT|VI|VA|VE|VO|RK|WI|WA)\s*\(?\s*([DRP])\s*\)?\s*-?\s*(\d{1,4}[A-Z]?)(?![0-9])/g;

/** Catalog keys of ENR areas named in NOTAM text, e.g. "WS(D)-44" → "WSD44". */
export function enrIdsInText(text: string): string[] {
  const out: string[] = [];
  const blob = String(text || "").toUpperCase();
  for (const m of blob.matchAll(ID_RE)) {
    const key = `${m[1]}${m[2]}${m[3]}`;
    const cand = RINGS[key] ? key : RINGS[key.replace(/[A-Z]$/, "")] ? key.replace(/[A-Z]$/, "") : "";
    if (cand && !out.includes(cand)) out.push(cand);
  }
  return out;
}

export function enrRing(key: string): Pt[] {
  return [...(RINGS[key] || [])];
}
