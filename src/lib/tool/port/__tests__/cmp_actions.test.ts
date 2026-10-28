import { describe, expect, it } from 'vitest';
import { patchCmpValidationPage, cmpValidationVerdict, cmpRegState, cmpAtcRegIssues } from '../cmp_validation';

const patched = patchCmpValidationPage('function renderCompareTable(d, opts){');
const start = patched.indexOf('function cmpActionFlight');
const end = patched.indexOf('const cmpRegState', start);
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

describe('Compare FPL registration and Briefing', () => {
  it('marks FPL registration as matched only against FliteBrief, not AIMS', () => {
    expect(cmpRegState('VNA657', 'VN-A657', 'VNA648').same).toBe(true);
    expect(cmpRegState('VNA657', 'VNA648', 'VNA657').same).toBe(false);
    expect(cmpRegState('', 'VNA657', 'VNA657').same).toBe(false);
  });
  it('disables BF when there is no aircraft change', () => {
    expect(cmpRegState('VNA657', 'VN-A657', 'VNA657').changed).toBe(false);
    expect(cmpRegState('', 'VN-A657', '').changed).toBe(false);
    expect(cmpRegState('VNA657', '', 'VNA648', true).changed).toBe(false);
  });
  it('enables BF for an aircraft mismatch or a confirmed version change', () => {
    expect(cmpRegState('VNA648', 'VNA657', 'VNA657').changed).toBe(true);
    expect(cmpRegState('VNA657', 'VNA657', 'VNA648').changed).toBe(true);
    expect(cmpRegState('VNA657', 'VNA657', 'VNA657', true).changed).toBe(true);
  });
});

describe('ATC status registration cross-check', () => {
  it('passes when AviWeb matches both FliteBrief and Crewlist', () => {
    expect(cmpAtcRegIssues('VN-A657', 'VNA657', 'VN-A657')).toEqual([]);
    expect(cmpAtcRegIssues('VN-A657', '', '')).toEqual([]);
  });
  it('flags an AviWeb registration that differs from FliteBrief', () => {
    expect(cmpAtcRegIssues('VNA648', 'VNA657', 'VNA648')).toEqual(['FliteBrief VNA657']);
  });
  it('flags an AviWeb registration that differs from Crewlist', () => {
    expect(cmpAtcRegIssues('VNA648', 'VNA648', 'VNA657')).toEqual(['Crewlist VNA657']);
    expect(cmpAtcRegIssues('VNA648', 'VNA657', 'VNA657')).toEqual(['FliteBrief VNA657', 'Crewlist VNA657']);
  });
});