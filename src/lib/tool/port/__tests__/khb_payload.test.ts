import { describe, expect, it } from 'vitest';
import { rawOmniPay } from '../khb_payload';

const flight = { flt: '774', date: '20/10/2026', dep: 'CXR', arr: 'HAN', std: '15:45', etd: '16:30' };
const rows = [
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:25:00', est_payload: 14770 },
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:45:00', est_payload: 15040 },
];
describe('KHB explicit EST download', () => {
  it('fills PLD with the original Omni EST, without rounding or adding 1000', () => {
    expect(rawOmniPay(rows, flight)).toBe('15040');
  });
  it('does not invent PLD when the matching day or route is missing', () => {
    expect(rawOmniPay(rows, { ...flight, date: '21/10/2026' })).toBeNull();
    expect(rawOmniPay(rows, { ...flight, arr: 'SGN' })).toBeNull();
  });
});