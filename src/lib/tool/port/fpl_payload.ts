import type { Db, Raw } from './fpl_tool';
const text = (v: unknown) => String(v ?? '').trim().toUpperCase();
const digits = (v: unknown) => text(v).replace(/\D/g, '').replace(/^0+/, '');
function dayOf(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/.exec(s);
  if (!m) return null;
  const y = Number(m[3]);
  return `${y < 100 ? y + 2000 : y}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}
function clockMinutes(value: unknown): number | null {
  const s = String(value ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s) ?? /^(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const hours = Number(m[1]), minutes = Number(m[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}
/** Never substitute a different date or route for missing EST.
 * STD is the schedule key; ETD is only a fallback when STD is unavailable. */
export function omniPayload(rows: Raw[], flight: Raw): number | null {
  const day = dayOf(flight.date);
  if (!day || !digits(flight.flt) || !text(flight.dep) || !text(flight.arr)) return null;
  let matches = rows.filter(r => digits(r.digits) === digits(flight.flt)
    && text(r.dep) === text(flight.dep) && text(r.arr) === text(flight.arr)
    && dayOf(r.std_local) === day);
  if (matches.length > 1) {
    const clock = clockMinutes(flight.std) ?? clockMinutes(flight.etd);
    if (clock === null) return null;
    const ranked = matches.map(row => {
      const time = clockMinutes(String(row.std_local ?? '').slice(11, 16));
      return { row, distance: time === null ? Infinity : Math.abs(time - clock) };
    }).filter(item => Number.isFinite(item.distance));
    const nearest = Math.min(...ranked.map(item => item.distance));
    // Equidistant schedules remain ambiguous; never pick by response order.
    matches = ranked.filter(item => item.distance === nearest).map(item => item.row);
  }
  if (matches.length !== 1) return null;
  const n = Number(matches[0]?.est_payload);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}
/** Preserve grid PAY; normal export keeps the original EST + 1000 rule. */
export function exportPayloadItems(db: Db, items: Raw[], rows: Raw[]): Raw[] {
  return items.map(item => {
    if (item.pay != null && String(item.pay).trim() !== '') return { ...item };
    const base = db.flight(Number(item.id)) ?? db.flights.find(f => digits(f.flt) === digits(item.flt));
    const flight = { ...base, ...item, flt: item.flt || base?.flt };
    const est = omniPayload(rows, flight);
    return { ...item, pay: est === null ? '9999' : String(est + 1000) };
  });
}
