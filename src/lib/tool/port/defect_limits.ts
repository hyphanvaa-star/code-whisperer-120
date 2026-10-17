export type AircraftLimit = Record<string, unknown>;
function key(row: AircraftLimit): string {
  const reg = String(row['reg'] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^VN/, '');
  const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
  return JSON.stringify([reg, text(row['defect']), text(row['limit'])]);
}
export function mergeDefectLimits(current: AircraftLimit[], previous: AircraftLimit[], incoming: AircraftLimit[]): AircraftLimit[] {
  const oldReport = new Set(previous.map(key));
  const kept = current.filter(row => String(row['reg'] ?? '').trim() &&
    (/\bLOW\s+EGT/i.test(String(row['defect'] ?? '')) || !oldReport.has(key(row))));
  const seen = new Set(kept.map(key));
  const merged = [...kept];
  for (const row of incoming) {
    const identity = key(row);
    if (!String(row['reg'] ?? '').trim() || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(row);
  }
  return merged;
}
