// Pure port of aip_jp.py: published Japanese training-area boundary tables.
import { iterLatLon, type Pt } from './notam_track';

export function parseEnr53Text(text: string): Record<string, Pt[]> {
  const blob = text.replace(/\r\n?/g, '\n');
  const marks: { pos: number; prefix?: string; area?: string }[] = [];
  for (const m of blob.matchAll(/\(([A-Z]{2})\)\s*(?:(\d+(?:-\d+){0,3}))?/gi)) {
    marks.push({ pos: m.index, prefix: m[1].toUpperCase(), area: m[2] });
  }
  for (const m of blob.matchAll(/(?:^|[^\dA-Z])(\d{1,2}(?:-\d{1,3}){1,3})(?=\s+(?:The airspace|\d{3,5}\s*-{2,}|FL))/gim)) {
    marks.push({ pos: m.index, area: m[1] });
  }
  marks.sort((a, b) => a.pos - b.pos);
  const out: Record<string, Pt[]> = {};
  let prefix = '', lastRing: Pt[] = [];
  marks.forEach((mark, i) => {
    if (mark.prefix) { prefix = mark.prefix; lastRing = []; }
    if (!prefix || !mark.area) return;
    const piece = blob.slice(mark.pos, marks[i + 1]?.pos ?? blob.length).replace(/N\s*\/\s*/gi, 'N ');
    const points = iterLatLon(piece);
    const ring = points.length >= 3 ? points : lastRing;
    if (ring.length < 3) return;
    lastRing = ring;
    out[prefix + mark.area] = ring;
  });
  return out;
}

/** Match actual catalog IDs, including CK3 and spacing/hyphen variations. */
export function idsInText(table: Record<string, Pt[]>, text: string): string[] {
  const blob = text.toUpperCase().replace(/[\s_]+/g, '');
  return Object.keys(table).filter((key) => {
    const escaped = key.toUpperCase().split('-').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('-?');
    return new RegExp(`(?<![A-Z0-9])${escaped}(?![A-Z0-9-])`).test(blob);
  });
}