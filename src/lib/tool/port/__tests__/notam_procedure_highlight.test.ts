import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nmSidHitNames, nmSidHitRes, patchNotamProcedureHighlightPage } from '../notam_procedure_highlight';

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

describe('tune round-trip procedure identity', () => {
  function apply(row: Record<string, unknown>, extra: Record<string, unknown>) {
    const context = vm.createContext({
      nmCritIdents: () => new Set(), nmNotamN: () => 1,
    });
    const namesStart = patched.indexOf('function nmSidHitNames(');
    const namesEnd = patched.indexOf('function nmSidStarRows(', namesStart);
    const tuneStart = patched.indexOf('function nmApplyTune(');
    const tuneEnd = patched.indexOf('function nmUndoTune(', tuneStart);
    vm.runInContext(patched.slice(namesStart, namesEnd) + patched.slice(tuneStart, tuneEnd), context);
    const pack = { places: [{ code: 'VVNB', notams: [row] }] };
    context['nmApplyTune'](pack, {}, extra);
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
});