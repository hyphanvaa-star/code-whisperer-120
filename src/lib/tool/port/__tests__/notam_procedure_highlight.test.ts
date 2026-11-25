import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nmSidHitNames, nmSidHitRes, nmRouteBodyHits, patchNotamProcedureHighlightPage } from '../notam_procedure_highlight';

const source = readFileSync('src/tool/page.html', 'utf8');
const patched = patchNotamProcedureHighlightPage(source);
const matches = (row: unknown, text: string) => nmSidHitRes(row)
  .some(pattern => new RegExp(pattern, 'i').test(text));

describe('procedure matches used by NOTAM body and summary', () => {
  it('uses DALAP from A4515/26 summary hits without the missing name map', () => {
    const row = { sid_star_hits: [{ cs: 'VJC143', procs: ['DALAP'] }, { cs: 'VJC149', procs: ['DALAP'] }] };
    expect(nmSidHitNames(row)).toEqual(['DALAP']);
    expect(matches(row, 'E) HLDG PATTERN DALAP NOT AVBL.')).toBe(true);
  });
  it('matches confirmed SID/STAR names in spaced and compact notation', () => {
    const row = { sid_star_hits: [{ cs: 'VJC143', procs: ['DALAP2B'] }] };
    expect(matches(row, 'RNAV STAR DALAP 2B NOT AVBL')).toBe(true);
    expect(matches(row, 'RNAV STAR DALAP2B NOT AVBL')).toBe(true);
    expect(matches(row, 'RNAV STAR DALAP 1A NOT AVBL')).toBe(false);
  });
  it('never treats all listed procedures as confirmed matches', () => {
    const row = { sid_star: ['DALAP', 'ANRAT'], sid_star_hits: [{ procs: ['DALAP'] }] };
    expect(matches(row, 'HLDG PATTERN ANRAT')).toBe(false);
    expect(matches(row, 'HLDG PATTERN DALAP')).toBe(true);
  });
  it('keeps exact token boundaries rather than matching another fix', () => {
    const row = { sid_star_hits: [{ procs: ['DALAP'] }] };
    expect(matches(row, 'XDALAP DALAPX DALAP2B')).toBe(false);
    expect(matches(row, '(DALAP),')).toBe(true);
  });
  it('empty current hits override stale names from a previous flight', () => {
    expect(nmSidHitNames({ sid_star_hits: [], sid_star_hit_names: ['DALAP'] })).toEqual([]);
  });
  it('supports legacy name-only records but rejects malformed values', () => {
    expect(nmSidHitNames({ sid_star_hit_names: ['dalap', null, 123, ''] })).toEqual(['DALAP']);
    expect(nmSidHitNames({ sid_star_hits: [null, { procs: 'DALAP' }, { procs: ['ANRAT', null] }] })).toEqual(['ANRAT']);
    expect(nmSidHitRes(null)).toEqual([]);
  });
});

describe('body-only confirmed ATS routes', () => {
  const text = 'E) ROUTES L642 AND M771: FL LIMITS';
  it('uses only L642 from the positive assessment, not every route named in the body', () => {
    expect(nmRouteBodyHits({ text, reasons: ['Chuyến bay trên ATS route L642 nêu trong NOTAM — kiểm tra đoạn/FL áp dụng.'] })).toEqual(['L642']);
  });
  it('never interprets a negative route assessment as a match', () => {
    expect(nmRouteBodyHits({ text, reasons: ['Đã quét đủ 2 ATS route (L642, M771) — không có route/điểm nào trên FPL.'] })).toEqual([]);
  });
  it('cannot revive old reasons after an authoritative empty retune', () => {
    expect(nmRouteBodyHits({ text, ofp_body_hits: [], reasons: ['Chuyến bay trên ATS route L642 nêu trong NOTAM'] })).toEqual([]);
  });
  it('does not guess routes from body text alone or match partial designators', () => {
    expect(nmRouteBodyHits({ text })).toEqual([]);
    expect(nmRouteBodyHits({ text: 'L6420', reasons: ['Chuyến bay trên ATS route L642 nêu trong NOTAM'] })).toEqual([]);
  });
});

describe('tune round-trip procedure identity', () => {
  function apply(row: Record<string, unknown>, extra: Record<string, unknown>, code = 'VVNB', dropped = {}) {
    const context = vm.createContext({
      nmCritIdents: () => new Set(), nmNotamN: () => 1,
    });
    const namesStart = patched.indexOf('function nmSidHitNames(');
    const namesEnd = patched.indexOf('function nmSidStarRows(', namesStart);
    const tuneStart = patched.indexOf('function nmApplyTune(');
    const tuneEnd = patched.indexOf('function nmUndoTune(', tuneStart);
    vm.runInContext(patched.slice(namesStart, namesEnd) + patched.slice(tuneStart, tuneEnd), context);
    const pack = { places: [{ code, notams: [row], dropped: [] as Record<string, unknown>[] }] };
    context['nmApplyTune'](pack, dropped, extra);
    if (pack.places[0]?.dropped.length) return pack.places[0].dropped[0];
    return pack.places[0]?.notams[0];
  }
  it('reads the keyed confirmed hit back onto A4515/26 without changing its text', () => {
    const row = { ident: 'A4515/26', text: 'E) HLDG PATTERN DALAP NOT AVBL' };
    const result = apply(row, { sid_star_hits: { 'VVNB\tA4515/26': [{ cs: 'VJC143', procs: ['DALAP'] }] } });
    expect(result?.['text']).toBe(row.text);
    expect(nmSidHitNames(result)).toEqual(['DALAP']);
    expect(nmSidHitNames(row)).toEqual(['DALAP']);
    expect(row).not.toHaveProperty('level');
  });
  it('a no-hit retune clears the prior flight instead of retaining DALAP', () => {
    const sourceRow = { ident: 'A4515/26', sid_star_hits: [{ procs: ['DALAP'] }], sid_star_hit_names: ['DALAP'] };
    const result = apply(sourceRow, { sid_star_hits: {} });
    expect(nmSidHitNames(result)).toEqual([]);
    expect(nmSidHitNames(sourceRow)).toEqual([]);
  });
  it('the same number at another airport never applies to this NOTAM', () => {
    const result = apply({ ident: 'A4515/26' }, { sid_star_hits: { 'VVTS\tA4515/26': [{ procs: ['DALAP'] }] } });
    expect(nmSidHitNames(result)).toEqual([]);
  });
  it('also shares confirmed L642 with the source list, not only the overview copy', () => {
    const row: Record<string, unknown> = { ident: 'A4543/26', text: 'E) L642 AND M771: FL LIMITS' };
    const result = apply(row, { ofp_hits: { 'VVHM\tA4543/26': ['L642'] } }, 'VVHM');
    expect(result?.['ofp_hits']).toEqual(['L642']);
    expect(row['ofp_hits']).toEqual(['L642']);
  });
  it('a no-match retune clears L642 in both rendered collections', () => {
    const row: Record<string, unknown> = { ident: 'A4543/26', ofp_hits: ['L642'] };
    const result = apply(row, { ofp_hits: {} }, 'VVHM');
    expect(result?.['ofp_hits']).toEqual([]);
    expect(row['ofp_hits']).toEqual([]);
  });
  it('the same NOTAM number in another FIR cannot supply L642', () => {
    const result = apply({ ident: 'A4543/26' }, { ofp_hits: { 'WSJC\tA4543/26': ['L642'] } }, 'VVHM');
    expect(result?.['ofp_hits']).toEqual([]);
  });
  it('a dropped NOTAM receives the same route metadata without changing its assessment', () => {
    const row: Record<string, unknown> = { ident: 'A4543/26', text: 'L642 AND M771' };
    const result = apply(row, { ofp_hits: { 'VVHM\tA4543/26': ['L642'] },
      assess: { 'VVHM\tA4543/26': { level: 'NO IMPACT', reasons: ['Outside flight window'] } } },
      'VVHM', { 'VVHM\tA4543/26': 'Outside flight window' });
    expect(result?.['level']).toBe('NO IMPACT');
    expect(result?.['ofp_hits']).toEqual(['L642']);
    expect(row['ofp_hits']).toEqual(['L642']);
    expect(row).not.toHaveProperty('level');
  });
});