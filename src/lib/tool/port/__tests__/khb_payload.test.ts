import { describe, expect, it } from 'vitest';
import { payloadPair, rawOmniPay, validationResult } from '../khb_payload';

const flight = { flt: '774', date: '20/10/2026', dep: 'CXR', arr: 'HAN', std: '15:45', etd: '16:30' };
const rows = [
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:25:00', est_payload: 14770 },
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:45:00', est_payload: 15040 },
];
describe('KHB explicit EST download', () => {
  it('marks complete passing comparison as Good', () => {
    expect(validationResult([], []).status).toBe('good');
  });
  it('warns when that flight has a comparison issue', () => {
    expect(validationResult(['CREW: lệch 1'], []).status).toBe('warning');
  });
  it('never marks missing or unfinished comparison as Good', () => {
    expect(validationResult([], ['OFP']).status).toBe('pending');
  });
  it('keeps a known warning visible even while other checks are pending', () => {
    expect(validationResult(['REG'], ['EST']).status).toBe('warning');
  });
  it('keeps OFP payload first and raw Omni EST second', () => {
    expect(payloadPair(15000, 16582)).toBe('15000 / 16582');
  });
  it('does not substitute one source for a missing source', () => {
    expect(payloadPair(null, 16582)).toBe('— / 16582');
    expect(payloadPair(15000, '')).toBe('15000 / —');
  });
  it('fills PLD with the original Omni EST, without rounding or adding 1000', () => {
    expect(rawOmniPay(rows, flight)).toBe('15040');
  });
  it('does not invent PLD when the matching day or route is missing', () => {
    expect(rawOmniPay(rows, { ...flight, date: '21/10/2026' })).toBeNull();
    expect(rawOmniPay(rows, { ...flight, arr: 'SGN' })).toBeNull();
  });
});