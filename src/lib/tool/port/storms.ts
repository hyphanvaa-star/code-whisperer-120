import type { GeoFeature } from './wx_overlay';

export type Storm = { name: string; id: string; label: string; source: string; at?: string };

/** Warning names remain available even when Google Earth overlays fail. */
export function jtwcStorms(rss: string): Storm[] {
  const plain = rss.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const storms = new Map<string, Storm>();
  const re = /(?:Super\s+Typhoon|Typhoon|Tropical\s+Storm|Tropical\s+Cyclone|Tropical\s+Depression|Hurricane)\s+(\d{1,2}[A-Z])\s*\(([^)]+)\)\s*Warning/gi;
  for (const m of plain.matchAll(re)) {
    const id = (m[1] || '').toUpperCase();
    const name = (m[2] || '').trim();
    if (id && name) storms.set(id, { id, name, label: `${name} (${id})`, source: 'JTWC' });
  }
  return [...storms.values()];
}

export function jmaCode(t: Record<string, unknown>): string {
  const code = String(t.tropicalCyclone ?? t.code ?? t.id ?? '');
  return /^[A-Za-z0-9_-]+$/.test(code) ? code : '';
}

function point(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 2 || value[0] == null || value[1] == null) return null;
  const [lat, lon] = value.map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat ?? 100) > 90 || Math.abs(lon ?? 200) > 180) return null;
  return [lon ?? 0, lat ?? 0];
}

export function jmaStorm(fcst: Record<string, unknown>[], target: Record<string, unknown> = {}) {
  const title = fcst.find(p => p.part === 'title') || {};
  const name = String((title.name as { en?: string } | undefined)?.en || 'TC');
  const id = String(title.typhoonNumber || target.typhoonNumber || jmaCode(target));
  const storm: Storm = { name, id, label: `${name}${id ? ` (${id})` : ''}`, source: 'JMA' };
  const features: GeoFeature[] = [];
  const line: number[][] = [];
  for (const p of fcst) {
    const c = p.coord as { center?: unknown } | undefined;
    const center = point(p.center ?? c?.center);
    if (!center) continue;
    const valid = p.validtime as { UTC?: string } | undefined;
    const at = String(valid?.UTC || p.time || p.initialTime || '');
    const label = at ? `${at.slice(8, 10)}/${at.slice(11, 13)}Z` : '';
    const props = { storm: storm.label, source: 'JMA', at, name: label, label };
    line.push(center);
    features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: center } });
    if (!storm.at) storm.at = at;
    const circle = p.probabilityCircle as { radius?: number } | undefined;
    const gale = p.galeWarningArea as { radius?: number; center?: unknown } | undefined;
    const radius = Number(circle?.radius || gale?.radius || 0);
    if (radius > 0 && Number.isFinite(radius)) features.push({ type: 'Feature', properties: { ...props, label: '', radiusM: radius, name: `${storm.label} · ${circle ? 'Forecast probability' : 'Gale warning'}`, fillOpacity: 0.08 }, geometry: { type: 'Point', coordinates: point(gale?.center) || center } });
  }
  if (line.length > 1) features.unshift({ type: 'Feature', properties: { storm: storm.label, name: storm.label, source: 'JMA' }, geometry: { type: 'LineString', coordinates: line } });
  return { storm, features };
}

export function mergeStorms(primary: Storm[], fallback: Storm[]): Storm[] {
  const out = [...primary];
  for (const storm of fallback) if (!out.some(s => s.name.toLowerCase() === storm.name.toLowerCase())) out.push(storm);
  return out;
}