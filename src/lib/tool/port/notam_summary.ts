import type { Verdict, VerdictRow } from './notam_verdict';

/** Reconcile the geometry-safe verdict with the current, per-place assessment. */
export function assessedVerdict(
  base: Verdict,
  places: Record<string, unknown>[],
  classify: (notice: Record<string, unknown>, place: Record<string, unknown>) => string[],
): Verdict {
  const grades = new Map<string, string>();
  const additions = new Map<string, VerdictRow[]>();
  const items: Record<string, unknown>[] = [];
  const keyOf = (icao: unknown, ident: unknown) => `${String(icao || '').toUpperCase()}\t${String(ident || '').toUpperCase()}`;
  const categories: Record<string, string> = { ad_closed: 'ad', rwy_closed: 'rwy', gps: 'gps', rffs: 'rffs', note: 'note' };
  for (const place of places || []) {
    const notices = [...(Array.isArray(place.notams) ? place.notams : []), ...(Array.isArray(place.dropped) ? place.dropped : [])];
    for (const raw of notices) {
      if (!raw || typeof raw !== 'object') continue;
      const n = raw as Record<string, unknown>;
      const ident = String(n.ident || '');
      const icao = String(place.code || n.icao || '').toUpperCase();
      const level = String(n.level || '');
      if (!ident || !level) continue;
      grades.set(keyOf(icao, ident), level);
      if (!['CRITICAL', 'DELAY-ONLY'].includes(level)) continue;
      const tags = classify(n, place);
      const text = [n.e_field, n.text].join(' ').toUpperCase();
      const runwayMatch = text.match(/\bRWY\s+([\dLRC/ ,]+?)(?=\s+(?:CLSD|CLOSED|NOT)|[.\n]|$)/);
      const runwayValue = (runwayMatch?.[1] || '').trim() || '?';
      for (const tag of tags) {
        const section = categories[tag];
        if (!section || (['ad', 'rwy'].includes(section) && String(place.kind).toUpperCase() !== 'A')) continue;
        const rows = additions.get(section) || [];
        rows.push({ label: icao, value: section === 'rwy' ? runwayValue : ident, ident, icao, hit: true });
        additions.set(section, rows);
      }
      items.push({ ...n, icao, kind: place.kind, tags });
    }
  }
  const keep = (r: VerdictRow) => {
    const ids = String(r.ident || '').toUpperCase().match(/\b[A-Z]{1,2}\d{3,5}\/\d{2}\b/g) || [String(r.ident || '').toUpperCase()];
    return ids.some(id => grades.get(keyOf(r.icao || r.label, id)) !== 'NO IMPACT');
  };
  const sections = (base.sections || []).map(section => {
    let rows = (section.rows || []).filter(keep);
    // Replace each assessed airport/category row, not an entire airport or section.
    const extra = additions.get(section.key) || [];
    const replacements = new Set(extra.map(r => keyOf(r.icao, r.ident)));
    rows = rows.filter(r => !replacements.has(keyOf(r.icao, r.ident)));
    const seen = new Set<string>();
    rows = [...rows, ...extra].filter(r => {
      const k = keyOf(r.icao, r.ident) + '\t' + r.value;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    const groups = (section.groups || []).map(g => ({ ...g, rows: g.rows.filter(keep) })).filter(g => g.rows.length);
    const hit = rows.length > 0 || groups.some(g => g.rows.length > 0);
    return { ...section, rows, ...(section.groups ? { groups } : {}), hit,
      answer: section.key === 'ad' ? `${hit ? 'có' : 'không có'} đóng cửa sân bay`
        : section.key === 'rwy' ? `${hit ? 'có' : 'không có'} đóng cửa rwy`
        : `${hit ? 'có' : 'không'} ảnh hưởng` };
  });
  const risk = sections.some(s => ['ad', 'area', 'ats', 'sidstar'].includes(s.key) && s.hit);
  const runway = sections.some(s => s.key === 'rwy' && s.hit);
  return { ...base, sections, status: risk ? 'risk' : runway ? 'wait' : 'clear', items: [...(base.items || []), ...items] };
}