export type AircraftLimit = Record<string, unknown>;
function key(row: AircraftLimit): string {
  const reg = String(row['reg'] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^VN/, '');
  const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return JSON.stringify([reg, text(row['defect']), text(row['limit'])]);
}
export function classifyDefectLimits(current: AircraftLimit[], report: AircraftLimit[]): AircraftLimit[] {
  const reportKeys = new Set(report.map(key));
  return current.map(row => ({ ...row, source: row['source'] === 'manual' || /\bLOW\s+EGT/i.test(String(row['defect'] ?? ''))
    ? 'manual' : row['source'] === 'summary' || reportKeys.has(key(row)) ? 'summary' : 'manual' }));
}
export function mergeDefectLimits(current: AircraftLimit[], previous: AircraftLimit[], incoming: AircraftLimit[]): AircraftLimit[] {
  const kept = classifyDefectLimits(current, previous).filter(row => String(row['reg'] ?? '').trim() && row['source'] === 'manual');
  const seen = new Set(kept.map(key));
  const merged = [...kept];
  for (const row of incoming) {
    const identity = key(row);
    if (!String(row['reg'] ?? '').trim() || seen.has(identity)) continue;
    seen.add(identity);
    merged.push({ ...row, source: 'summary' });
  }
  const egt = (r: AircraftLimit) => /\bLOW\s+EGT/i.test(String(r['defect'] ?? ''));
  return [...merged.filter(egt), ...merged.filter(r => !egt(r))];
}
