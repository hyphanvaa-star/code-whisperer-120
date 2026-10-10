import type { Db, Raw } from './fpl_tool';

const text = (value: unknown) => String(value ?? '').trim().toUpperCase();
const digits = (value: unknown) => text(value).replace(/^VJC?/, '').replace(/^0+(?=\d)/, '');

/** Spreadsheet row IDs can change when another crewlist is imported. */
export function resolveCrewFlight(db: Db, spec: Raw): Raw | null {
  const byRow = db.flight(Number(spec.id));
  if (!text(spec.flt)) return byRow;
  const matches = (f: Raw) => digits(f.flt) === digits(spec.flt)
    && ['date', 'dep', 'arr', 'etd'].every(key => !text(spec[key]) || text(f[key]) === text(spec[key]));
  if (byRow && matches(byRow)) return byRow;
  const candidates = db.flights.filter(matches);
  return candidates.length === 1 ? candidates[0] ?? null : null;
}