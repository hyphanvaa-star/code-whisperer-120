import { describe, expect, it } from 'vitest';
import { omniPayload, exportPayloadItems } from '../fpl_payload';
import { Db, build_req, round_est, flights_from_crew_sheet, public_flights } from '../fpl_tool';
import seed from '../../data/fpl_tool.json';
const flights = [
  { id: 1, flt: '813', date: '12/10/26', dep: 'SGN', arr: 'SIN', etd: '07:10', ac: '321', reg: 'VNA649' },
  { id: 2, flt: '970', date: '12/10/26', dep: 'SIN', arr: 'DAD', etd: '11:15', ac: '321', reg: 'VNA649' },
  { id: 3, flt: '120', date: '12/10/26', dep: 'SGN', arr: 'HAN', etd: '05:00', ac: '321', reg: 'VNA632' },
];
const ests = [22329, 14540, 16980];
const rows = flights.flatMap((f, i) => [
  { digits: f.flt, dep: f.dep, arr: f.arr, std_local: `2026-10-11T${f.etd}:00.000Z`, est_payload: 12345 },
  { digits: f.flt, dep: f.dep, arr: f.arr, std_local: `2026-10-12T${f.etd}:00.000Z`, est_payload: ests[i] },
]);
const db = new Db({ ...seed, flights });
const omni774 = [
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:25:00', est_payload: 14770 },
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:45:00', est_payload: 15040 },
];
const flight774 = { flt: '774', date: '20/10/2026', dep: 'CXR', arr: 'HAN', std: '15:45', etd: '16:30' };
describe('KHB flight-date payload', () => {
  it('VJC774 matches STD 15:45 EST 15040, not delayed ETD 16:30', () => {
    expect(omniPayload(omni774, flight774)).toBe(15040);
  });
  it('selects nearest same-day schedule when STD has no exact match', () => {
    expect(omniPayload(omni774, { ...flight774, std: '15:40' })).toBe(15040);
  });
  it('never resolves equally near schedules arbitrarily', () => {
    expect(omniPayload(omni774, { ...flight774, std: '15:35' })).toBeNull();
  });
  it('falls back to ETD only when STD is absent', () => {
    expect(omniPayload(omni774, { ...flight774, std: '', etd: '15:25' })).toBe(14770);
  });
  it('nearest-time matching cannot use another day or route', () => {
    expect(omniPayload(omni774, { ...flight774, date: '21/10/2026' })).toBeNull();
    expect(omniPayload(omni774, { ...flight774, arr: 'SGN' })).toBeNull();
  });
  it('reads separate STD by column name and keeps ETD in the exported REQ', () => {
    const parsed = flights_from_crew_sheet({
      header: ['ETD', 'ARR', 'DATE', 'FLT', 'STD', 'REG', 'DEP', 'AC'], header_row: 0,
      rows: [['16:30', 'HAN', '20/10/2026', 774, '15:45', 'VN-A649', 'CXR', 321]],
    });
    const parsedDb = new Db({ ...seed, flights: parsed });
    const shown = public_flights(parsedDb, [], null);
    expect(shown[0]?.std).toBe('15:45');
    expect(shown[0]?.etd).toBe('16:30');
    expect(omniPayload(omni774, shown[0] ?? {})).toBe(15040);
    const items = exportPayloadItems(parsedDb, shown, omni774);
    expect(items[0]?.pay).toBe('16040');
    expect(build_req(parsedDb, items, 'TEST', [])).toContain('ETD÷0930');
  });
  it.each(flights.map((f, i) => [f, ests[i]] as const))('matches October 12', (f, est) => {
    expect(omniPayload(rows, f)).toBe(est);
  });
  it('never substitutes another day, route or missing date', () => {
    expect(omniPayload(rows, { ...flights[0], date: '13/10/26' })).toBeNull();
    expect(omniPayload(rows, { ...flights[0], arr: 'HAN' })).toBeNull();
    expect(omniPayload(rows, { ...flights[0], date: '' })).toBeNull();
  });
  it('supports ISO and four-digit years', () => {
    expect(omniPayload(rows, { ...flights[0], date: '2026-10-12' })).toBe(22329);
    expect(omniPayload(rows, { ...flights[0], date: '12/10/2026' })).toBe(22329);
  });
  it('normal export ignores seed and uses correct EST + 1000', () => {
    const items = exportPayloadItems(db, flights, rows);
    expect(items.map(i => i.pay)).toEqual(['23329', '15540', '17980']);
    expect(build_req(db, items, 'TEST', []).match(/PAY÷\d+/g)).toEqual(['PAY÷23329', 'PAY÷15540', 'PAY÷17980']);
  });
  it('preserves explicit grid PAY', () => {
    expect(exportPayloadItems(db, [{ ...flights[0], pay: '22000' }], rows)[0]?.pay).toBe('22000');
  });
  it('missing correct date uses 9999', () => {
    expect(exportPayloadItems(db, [{ ...flights[0], date: '13/10/26' }], rows)[0]?.pay).toBe('9999');
  });
  it('keeps the original rounding rules', () => {
    expect(flights.map(f => round_est(omniPayload(rows, f) ?? 0, f.ac)[0])).toEqual([22300, 15000, 17500]);
  });
});
