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
const ROUTE_TO_HDR = /^[ \t]*ROUTE[ \t]+TO[ \t]+(FIRST|1ST|SECOND|2ND|TAKE[ \t]*-?OFF|T\/O|TKOF)[ \t]+ALT(?:N|ERNATE)?\b|^[ \t]*ROUTE[ \t]+TO[ \t]+ALT(?:N|ERNATE)?[ \t]*-?[ \t]*([12])\b/im;
const BLOCK_END = /^[ \t]*ELEV[ \t]+\d+[ \t]*FT\b|START[ \t]+OF[ \t]+WIND|\(FPL-|\bATC[ \t]+FPL\b|AIR[ \t]+OPS[ \t]+QUALIFICATION/i;
const PAGE_HDR = /^[ \t]*REF:|[ \t]-[ \t]+[A-Z]{4}\b.*\bOFP[ \t]*$/i;
const key = (p: NavPoint) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;

function hdrKind(ln: string): AltKind | null {
  const m = new RegExp(ROUTE_TO_HDR.source, "i").exec(ln);
  if (!m) return null;
  const w = (m[1] || m[2] || "").toUpperCase().replace(/\s+/g, "");
  if (w === "FIRST" || w === "1ST" || w === "1") return "alt1";
  if (w === "SECOND" || w === "2ND" || w === "2") return "alt2";
  return "talt";
}

/** Strict split: each alternate NAV LOG runs from its "ROUTE TO … ALTERNATE" heading to
 *  the alternate's ELEV line (or the next heading / wind summary / ATC FPL). */
function parseExplicit(src: string, icao: Record<AltKind, string>): AltRoutes {
  const out: AltRoutes = { alt1: null, alt2: null, talt: null, icao };
  const main: string[] = [];
  const blocks: { kind: AltKind; lines: string[] }[] = [];
  let cur: { kind: AltKind; lines: string[] } | null = null;
  let seenHdr = false;
  for (const raw of src.split(/\r?\n/)) {
    const ln = raw.toUpperCase();
    const k = hdrKind(ln);
    if (k) { cur = { kind: k, lines: [] }; blocks.push(cur); seenHdr = true; continue; }
    if (cur) {
      if (BLOCK_END.test(ln) && cur.lines.some((l) => COORD.test(l))) { cur = null; continue; }
      // Page headers inside a NAV LOG ("Ref: OPS GEN." / "VJC5288 VVCR - ZSHC VNA629  OFP")
      // would otherwise lend their airport codes to the next waypoint.
      if (PAGE_HDR.test(ln)) continue;
      cur.lines.push(raw);
    } else if (!seenHdr) main.push(raw);
  }
  const mainKeys = new Set(parseNavlog(main.join("\n")).points.map(key));
  for (const b of blocks) {
    if (out[b.kind]) continue;
    const nav = parseNavlog(b.lines.join("\n"));
    if (nav.points.length < 2) continue;
    // A copy of the main NAV LOG is never an alternate route.
    if (mainKeys.size && nav.points.every((p) => mainKeys.has(key(p)))) continue;
    out[b.kind] = { kind: b.kind, icao: icao[b.kind], points: nav.points, line: nav.line };
  }
  return out;
}

export function parseAltRoutes(text: string, dest = ""): AltRoutes {
  const src = String(text || "");
  const icao: Record<AltKind, string> = { alt1: "", alt2: "", talt: "" };
  for (const m of src.matchAll(ALT_LINE)) {
    const k = m[1] === "1" ? "alt1" : "alt2";
    if (!icao[k]) icao[k] = m[2]!.toUpperCase();
  }
  const t = /\bTALT\/([A-Z]{4})\b/.exec(src) || TALT_ICAO.exec(src);
  if (t) icao.talt = (t[1] || t[2] || "").toUpperCase();

  // JetPlan OFPs label each alternate NAV LOG explicitly ("ROUTE TO FIRST ALTERNATE: …").
  // When present, only those headings open alternate blocks: the ETP / DESTINATION
  // ALTERNATE DATA / TAKE OFF ALT / ENROUTE ALT summaries before the main NAV LOG
  // otherwise get mistaken for ALT1 and swallow the whole DEP→DEST route.
  if (ROUTE_TO_HDR.test(src)) return parseExplicit(src, icao);

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
