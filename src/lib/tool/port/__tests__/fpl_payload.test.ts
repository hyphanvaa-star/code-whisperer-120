import { describe, expect, it } from 'vitest';
import { omniPayload, exportPayloadItems } from '../fpl_payload';
import { Db, build_req, round_est } from '../fpl_tool';
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
describe('KHB flight-date payload', () => {
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
