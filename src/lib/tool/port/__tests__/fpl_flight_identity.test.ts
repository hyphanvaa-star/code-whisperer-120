import { describe, expect, it } from 'vitest';
import { Db, round_est } from '../fpl_tool';
import { resolveCrewFlight } from '../fpl_flight_identity';

const flight = { row: 20, flt: '858', date: '09/10/2026', dep: 'SGN', arr: 'MNL', etd: '22:25', ac: '321' };
const spec = { ...flight, id: 10, flt: 'VJC858' };
describe('KHB crewlist flight identity', () => {
  it('resolves a moved row and rounds its PLD', () => {
    const found = resolveCrewFlight(new Db({ flights: [flight] }), spec);
    expect(found).toEqual(flight);
    expect(round_est(18123, String(found?.ac))).toEqual([18600, '']);
  });
  it('rejects recycled row IDs belonging to another flight', () => {
    expect(resolveCrewFlight(new Db({ flights: [{ ...flight, row: 10, flt: '859' }, flight] }), spec)).toEqual(flight);
  });
  it('never matches a different day or route', () => {
    expect(resolveCrewFlight(new Db({ flights: [{ ...flight, date: '10/10/2026' }] }), spec)).toBeNull();
    expect(resolveCrewFlight(new Db({ flights: [{ ...flight, dep: 'MNL', arr: 'SGN' }] }), spec)).toBeNull();
  });
  it('rejects ambiguous matches and preserves row-only requests', () => {
    const db = new Db({ flights: [flight, { ...flight, row: 21 }] });
    expect(resolveCrewFlight(db, spec)).toBeNull();
    expect(resolveCrewFlight(db, { id: 20 })).toEqual(flight);
  });
});