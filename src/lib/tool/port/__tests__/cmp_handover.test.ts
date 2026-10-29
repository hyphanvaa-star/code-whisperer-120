import { describe, expect, it } from 'vitest';
import { cmpHandoverRows } from '../cmp_handover';

const rows = [
  { sector_id: 430, dsp: 'PHAN THANH HY' },
  { sector_id: 642, dsp: 'BUI T H NHUNG' },
  { sector_id: 807, dsp: 'OTHER DSP' },
  { sector_id: 431, dsp: 'PHAN THANH HY' },
];
describe('Compare handover scope', () => {
  it('places added DSP flights above normal primary flights', () => {
    const result = cmpHandoverRows(rows, 'PHAN THANH HY', ['BUI T H NHUNG']);
    expect(result.map(r => r.sector_id)).toEqual([642, 430, 431]);
    expect(result.map(r => r.handover)).toEqual([true, false, false]);
  });
  it('removes an unselected handover DSP without changing primary rows', () => {
    expect(cmpHandoverRows(rows, 'PHAN THANH HY', []).map(r => r.sector_id)).toEqual([430, 431]);
  });
  it('never tags the primary DSP as handover after switching primary selection', () => {
    const result = cmpHandoverRows(rows, 'BUI T H NHUNG', [' bui t h nhung ']);
    expect(result).toEqual([{ sector_id: 642, dsp: 'BUI T H NHUNG', handover: false }]);
  });
  it('adds multiple DSPs without duplicating a sector', () => {
    expect(cmpHandoverRows([...rows, rows[1]], 'PHAN THANH HY', ['BUI T H NHUNG', 'OTHER DSP']).map(r => r.sector_id)).toEqual([642, 807, 430, 431]);
  });
  it('keeps ALL available with selected handovers first', () => {
    expect(cmpHandoverRows(rows, '', ['OTHER DSP']).map(r => r.sector_id)).toEqual([807, 430, 642, 431]);
  });
});