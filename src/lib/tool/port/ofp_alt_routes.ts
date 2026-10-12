// Alternate routes from the OFP text: destination ALT1 / ALT2 and take-off alternate.
// JetPlan KML only plots DEP→DEST, so these come from the OFP's alternate NAV LOG blocks.
import { parseNavlog, type NavPoint } from "./ofp_navlog";

export type AltKind = "alt1" | "alt2" | "talt";
export interface AltRoute { kind: AltKind; icao: string; points: NavPoint[]; line: [number, number][] }
export interface AltRoutes { alt1: AltRoute | null; alt2: AltRoute | null; talt: AltRoute | null; icao: Record<AltKind, string> }

const COORD = /\b[NS]\d{4,5}\s?[EW]\d{5,6}\b/;
const ALT_LINE = /^[ \t]*ALT([12])[ \t]+([A-Z]{4})\b/gim;
const TALT_ICAO = /\bTALT\/([A-Z]{4})\b|TAKE[ \t]*-?OFF[ \t]+ALT(?:N|ERNATE)?\b(?:[ \t]*[:=][ \t]*|[ \t]+)([A-Z]{4})\b/i;
const TALT_HDR = /\b(TAKE[ \t]*-?OFF[ \t]+ALT(?:N|ERNATE)?|TKOF[ \t]+ALTN?|T\/O[ \t]+ALTN?|TO[ \t]+ALTN)\b/i;
const ALT_HDR = /\b(ALTN?[ \t]*[12]?|ALTERNATE|DEST(?:INATION)?[ \t]+ALTN?)\b/i;
const STOP_HDR = /\(FPL-|\bATC[ \t]+FPL\b|\bETP\b|\bWIND[ \t]+INFO/i;

export function parseAltRoutes(text: string, dest = ""): AltRoutes {
  const src = String(text || "");
  const icao: Record<AltKind, string> = { alt1: "", alt2: "", talt: "" };
  for (const m of src.matchAll(ALT_LINE)) {
    const k = m[1] === "1" ? "alt1" : "alt2";
    if (!icao[k]) icao[k] = m[2]!.toUpperCase();
  }
  const t = TALT_ICAO.exec(src);
  if (t) icao.talt = (t[1] || t[2] || "").toUpperCase();

  // Split the text into sections: main NAV LOG first, then each alternate block.
  const blocks: { kind: AltKind | "main" | "skip"; lines: string[] }[] = [{ kind: "main", lines: [] }];
  let cur = blocks[0]!;
  let mainHasCoords = false;
  for (const raw of src.split(/\r?\n/)) {
    const ln = raw.toUpperCase();
    const hasCoord = COORD.test(ln);
    if (!hasCoord && mainHasCoords) {
      let kind: AltKind | "skip" | null = null;
      if (STOP_HDR.test(ln)) kind = "skip";
      else if (TALT_HDR.test(ln) && !/TALT\/[A-Z]{4}/.test(ln)) kind = "talt";
      else if (ALT_HDR.test(ln)) {
        const two = /\bALTN?[ \t]*2\b/.test(ln) || (!!icao.alt2 && ln.includes(icao.alt2) && !(icao.alt1 && ln.includes(icao.alt1)));
        kind = two ? "alt2" : "alt1";
      }
      if (kind) {
        if (cur.kind !== "main" && cur.lines.every((l) => !COORD.test(l))) cur.kind = kind; // heading overrides empty block
        else { cur = { kind, lines: [] }; blocks.push(cur); }
      }
    }
    if (hasCoord && cur.kind === "main") mainHasCoords = true;
    cur.lines.push(raw);
  }

  const out: AltRoutes = { alt1: null, alt2: null, talt: null, icao };
  const mainKeys = new Set(parseNavlog(blocks[0]!.lines.join("\n")).points.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`));
  const destU = dest.toUpperCase();
  for (const b of blocks.slice(1)) {
    if (b.kind === "main" || b.kind === "skip") continue;
    let kind: AltKind = b.kind;
    if (out[kind]) {
      // ALT1 taken: an unlabelled second destination-alternate block is ALT2.
      if (kind === "alt1" && !out.alt2) kind = "alt2"; else continue;
    }
    const nav = parseNavlog(b.lines.join("\n"));
    // A repeat of the main NAV LOG is not an alternate.
    const fresh = nav.points.filter((p) => !mainKeys.has(`${p.lat.toFixed(3)},${p.lon.toFixed(3)}`));
    if (nav.points.length < 2 || fresh.length === 0) continue;
    if (kind !== "talt" && destU && nav.points.length && nav.points.every((p) => p.name === destU)) continue;
    out[kind] = { kind, icao: icao[kind], points: nav.points, line: nav.line };
  }
  return out;
}
