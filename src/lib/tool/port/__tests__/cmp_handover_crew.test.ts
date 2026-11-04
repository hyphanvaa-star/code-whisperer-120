import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchCmpValidationPage } from '../cmp_validation';

const html = patchCmpValidationPage(readFileSync('src/tool/page.html', 'utf8'));
const scope = 'dispatcher=PHAN+THANH+HY&dep=VVTS&refresh=1';

async function readCrew(handover: boolean, names = false, opts: { cache?: Record<string, unknown>; dsps?: string[] } = {}) {
  const calls: URLSearchParams[] = [];
  const painted: unknown[] = [];
  const table = [{ sector_id: 642, in_excel: true, handover }];
  const context = vm.createContext({
    URLSearchParams, Map, Set, console,
    qs: () => scope,
    $: (s: string) => ({ value: s === '#cmpSheet' ? 'CREW' : 'PHAN THANH HY' }),
    xls: { file: 'Crewlist.xlsx' }, lastCmp: { table },
    cmpHandoverRevision: 1,
    C_CACHE: opts.cache || {}, cmpHandoverDsps: new Set(opts.dsps || []), C_BATCH: 40, cSeq: 0,
    CREW_NAMES: {}, cmpNameQ: new Set([642]),
    crewStat() {}, write() {}, cmpBind: {},
    paintCrew: (id: number, cell: unknown) => painted.push([id, cell]),
    document: { querySelectorAll: () => [] },
    fetch: async (url: string) => {
      const p = new URL(url, 'http://localhost').searchParams;
      calls.push(p);
      const included = !handover || !p.has('dispatcher');
      return { json: async () => ({
        crew: included ? { 642: { verdict: true, same: true } } : {},
        names: included ? { 642: 'CAPT 1234 / FO 5678' } : {},
      }) };
    },
  });
  const helperStart = html.indexOf('function cmpCrewParams(');
  if (helperStart >= 0) {
    const helperEnd = html.indexOf('async function runCompare(opts){', helperStart);
    vm.runInContext(html.slice(helperStart, helperEnd), context);
  }
  const start = html.indexOf(names ? 'async function cmpFlushNames(){' : 'async function fillCrew(rows, force){');
  const end = html.indexOf(names ? '\nfunction cmpFltNum' : '\nfunction paintCrew', start);
  vm.runInContext(html.slice(start, end), context);
  await vm.runInContext(names ? 'cmpFlushNames()' : 'fillCrew(lastCmp.table, false)', context);
  return { calls, painted, context };
}

describe('Compare handover crew reads', () => {
  it('reads crew for the handover sector rather than filtering it by the primary DSP', async () => {
    const { calls, painted } = await readCrew(true);
    expect(calls[0]?.has('dispatcher')).toBe(false);
    expect(calls[0]?.get('ids')).toBe('642');
    expect(calls[0]?.get('dep')).toBe('VVTS');
    expect(calls[0]?.get('file')).toBe('Crewlist.xlsx');
    expect(painted).toEqual([[642, { verdict: true, same: true }]]);
  });
  it('reads names for the same handover sector', async () => {
    const { calls, context } = await readCrew(true, true);
    expect(calls[0]?.has('dispatcher')).toBe(false);
    expect(calls[0]?.get('ids')).toBe('642');
    expect(vm.runInContext('CREW_NAMES[642]', context)).toBe('CAPT 1234 / FO 5678');
  });
  it('keeps the primary DSP filter when the displayed table has no handover rows', async () => {
    for (const names of [false, true]) {
      const { calls } = await readCrew(false, names);
      expect(calls[0]?.get('dispatcher')).toBe('PHAN THANH HY');
    }
  });
  it('drops the primary DSP filter whenever a handover DSP is selected', async () => {
    const { calls } = await readCrew(false, false, { dsps: ['BUI T H NHUNG'] });
    expect(calls[0]?.has('dispatcher')).toBe(false);
  });
  it('retries a cached missing crew instead of keeping the dash', async () => {
    const { calls, painted } = await readCrew(true, false, { cache: { 642: null } });
    expect(calls.length).toBe(1);
    expect(painted).toEqual([[642, { verdict: true, same: true }]]);
  });
});
