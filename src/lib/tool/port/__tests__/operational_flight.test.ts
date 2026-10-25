import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseOpsDate, sameOpsDay, selectOperationalFlight, validateOperationalAtc } from '../operational_flight';
import { filterByWindow } from '../../core/gantts.server';
import { Flight } from '../../core/models';
const now = new Date('2026-10-25T06:03:00Z');
const flight = { id: 80725, callsign: 'VJC807', std: new Date('2026-10-25T08:30:00Z'), dep_iata: 'SGN', dep_icao: 'VVTS', dest_iata: 'BKK', dest_icao: 'VTBS' };
const spec = { flt: '807', date: '25/10/2026', dep: 'SGN', arr: 'BKK' };
const block = '(FPL-VJC807-IS\n-A321/M-S\n-VVTS0830\n-N0450F330 DCT\n-VTBS0130\n-DOF/261025 REG/VNA629)';
afterEach(() => vi.useRealTimers());
describe('operational flight identity', () => {
  it('VJC807 chooses October 25 0830, never yesterday 0745', () => {
    expect(selectOperationalFlight([{ ...flight, id: 80724, std: new Date('2026-10-24T07:45:00Z') }, flight], spec, now).id).toBe(80725);
  });
  it('rejects an old sector ID even if explicitly supplied', () => {
    expect(() => selectOperationalFlight([{ ...flight, std: new Date('2026-10-24T07:45:00Z') }], { sector_id: flight.id }, now)).toThrow('−6/+24');
  });
  it('does not fall back when the requested route is absent', () => {
    expect(() => selectOperationalFlight([flight], { ...spec, arr: 'HAN' }, now)).toThrow();
  });
  it('missing date never bypasses filtering', () => {
    expect(() => selectOperationalFlight([flight], { ...spec, date: '' }, now)).toThrow('Thiếu');
  });
  it('invalid dates fail closed', () => {
    expect(sameOpsDay(flight.std, 'wrong')).toBe(false);
    expect(parseOpsDate('31/02/2026')).toBeNull();
  });
  it('does not pick arbitrarily among duplicate daily sectors', () => {
    expect(() => selectOperationalFlight([flight, { ...flight, id: 99 }], spec, now)).toThrow('nhiều');
  });
  it('explicit sector ID must still match date and route', () => {
    expect(() => selectOperationalFlight([flight], { ...spec, sector_id: flight.id, date: '24/10/2026' }, now)).toThrow();
  });
  it('rejects yesterday DOF from an otherwise correct OFP', () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    expect(() => validateOperationalAtc(block, flight)).not.toThrow();
    expect(() => validateOperationalAtc(block.replace('DOF/261025', 'DOF/261024').replace('VVTS0830', 'VVTS0745'), flight)).toThrow('DOF');
  });
  it('keeps exactly inclusive minus 6 plus 24 boundaries, drops one millisecond beyond', () => {
    const times = [-6 * 3600_000 - 1, -6 * 3600_000, 24 * 3600_000, 24 * 3600_000 + 1];
    const rows = times.map((offset, id) => new Flight({ id, std: new Date(now.getTime() + offset) }));
    expect(filterByWindow(rows, 6, 24, now).map(f => f.id)).toEqual([1, 2]);
  });
});