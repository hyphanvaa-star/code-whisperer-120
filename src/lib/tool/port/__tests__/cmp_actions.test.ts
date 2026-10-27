import { describe, expect, it } from 'vitest';
import { patchCmpValidationPage, cmpValidationVerdict } from '../cmp_validation';

const patched = patchCmpValidationPage('function renderCompareTable(d, opts){');
const start = patched.indexOf('function cmpActionFlight');
const end = patched.indexOf('const cmpValidationVerdict', start);
const select = new Function('flights', 'inOpsWindow', 'r', patched.slice(start, end) + '\nreturn cmpActionFlight(r);');
const flight = { id: 64200, callsign: 'VJC642', std: '2026-10-27T08:00:00Z', reg: 'VN-A642' };
const row = { sector_id: 64200, callsign: 'VJC642' };

describe('Compare operational action target', () => {
  it('uses the matched FliteBrief sector instead of a spreadsheet row', () => {
    expect(select([flight], () => true, row)).toEqual(flight);
    expect(select([flight], () => true, { ...row, sector_id: 300 })).toBeNull();
  });
  it('blocks flights outside the operational window', () => {
    expect(select([flight], () => false, row)).toBeNull();
  });
  it('blocks ambiguous or mismatched flight identities', () => {
    expect(select([flight, { ...flight }], () => true, row)).toBeNull();
    expect(select([flight], () => true, { ...row, callsign: 'VJC632' })).toBeNull();
  });
});

describe('Compare Validation', () => {
  it('keeps failed checks ahead of near-limit checks', () => {
    expect(cmpValidationVerdict([{ label: 'TOW', level: 'bad' }, { label: 'LWT', level: 'warn' }])).toBe('bad');
    expect(cmpValidationVerdict([{ label: 'TOW', level: 'ok' }])).toBe('good');
  });
});