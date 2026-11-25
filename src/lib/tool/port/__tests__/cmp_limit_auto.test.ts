import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchCmpLimitAutoPage } from '../cmp_limit_auto';
import { patchCmpValidationPage } from '../cmp_validation';

const html = patchCmpLimitAutoPage(patchCmpValidationPage(readFileSync('src/tool/page.html', 'utf8')));
const code = html.slice(html.indexOf('const cmpLimitResults = new Map();'), html.indexOf('function routeCmpCell(r){'));
const pending = [{ severity: 'warning', check: 'ofp', evidence: 'Chưa check OFP — bấm Check OFP live' }];
const red = [{ severity: 'critical', check: 'ofp', evidence: 'OFP FL320 = 32000 FT > 500 FT' }];
type Flight = { id: number; callsign: string; plan_no: string; reg: string; std: string; limit_warns: typeof pending; needs_ofp_limit_check: boolean };
const flight = (id = 676): Flight => ({ id, callsign: 'VJC' + id, plan_no: '123', reg: 'VN-A676', std: '2026-11-25T15:00:00Z', limit_warns: structuredClone(pending), needs_ofp_limit_check: true });
function setup(options: { cached?: boolean; handover?: boolean; response?: Record<string, unknown>; fetch?: () => Promise<unknown> } = {}) {
  const f = flight();
  const reads: string[] = [];
  const painted: unknown[][] = [];
  const response = options.response || { weights: { 676: { plan_no: '123' } }, limit_warns: { 676: red } };
  const c = {
    wSeq: 0, flights: options.handover ? [] as Flight[] : [f], allFlights: [structuredClone(f)],
    W_CACHE: options.cached ? { 676: { plan_no: '123' } } as Record<string, unknown> : {} as Record<string, unknown>, W_BATCH: 20, DAYS: 1,
    limData: {}, ofpRulesCache: null,
    cmpFlightPool: (): Flight[] => [...new Map([...c.allFlights, ...c.flights].map(v => [v.id, v])).values()],
    inOpsWindow: () => true, ofpStamp: (v: Flight) => [v.plan_no, v.reg, v.std].join('|'),
    ofpFitsFlight: (v: Flight, w: { plan_no: string; cfp_mismatch?: boolean }) => !w.cfp_mismatch && v.plan_no === w.plan_no,
    needsOfpCheck: (v: Flight) => v.needs_ofp_limit_check,
    repaintLimitCells: (ids: unknown[]) => painted.push(ids), paintWeight() {}, paintEstBang() {}, paintExtraCells() {}, write() {},
    $: () => null, console,
    fetch: async (url: string) => {
      reads.push(url);
      const result = options.fetch ? await options.fetch() : response;
      return { json: async () => result };
    },
  };
  vm.createContext(c);
  vm.runInContext(code, c);
  const run = (force = false) => vm.runInContext(`fillWeights([{sector_id:"676"}],${force})`, c) as Promise<void>;
  return { c, reads, painted, run };
}

describe('automatic Compare LIMIT checks', () => {
  it('checks cached weights automatically and upgrades the 500 FT defect to red', async () => {
    const { c, reads, run } = setup({ cached: true });
    await run();
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain('ids=676&cache=1');
    expect(c.flights[0]?.limit_warns).toEqual(red);
    expect(c.allFlights[0]?.limit_warns).toEqual(red);
  });
  it('restores the completed result after a flight refresh without downloading again', async () => {
    const { c, reads, run } = setup({ cached: true });
    await run();
    c.flights = [flight()]; c.allFlights = [flight()];
    await run();
    expect(reads).toHaveLength(1);
    expect(c.flights[0]?.limit_warns).toEqual(red);
  });
  it('uses the existing batch only once when weights are not cached', async () => {
    const { reads, run } = setup();
    await run();
    expect(reads).toHaveLength(1);
  });
  it('does not restore an old verdict after another reader replaces the OFP weights', async () => {
    const { c, reads, run } = setup({ cached: true });
    await run();
    c.W_CACHE['676'] = { plan_no: '123' };
    c.flights = [flight()]; c.allFlights = [flight()];
    await run();
    expect(reads).toHaveLength(2);
    expect(c.flights[0]?.limit_warns).toEqual(red);
  });
  it('updates string-ID handover sectors outside the primary DSP', async () => {
    const { c, reads, run } = setup({ handover: true, cached: true });
    await run();
    expect(reads).toHaveLength(1);
    expect(c.flights).toEqual([]);
    expect(c.allFlights[0]?.limit_warns).toEqual(red);
  });
  it('accepts a valid empty result instead of keeping a pending warning', async () => {
    const { c, reads, run } = setup({ cached: true, response: { weights: { 676: { plan_no: '123' } }, limit_warns: { 676: [] } } });
    await run(); await run();
    expect(c.flights[0]?.limit_warns).toEqual([]);
    expect(reads).toHaveLength(1);
  });
  it('keeps a yellow caution when the returned OFP result is not a violation', async () => {
    const yellow = [{ severity: 'warning', check: 'ofp', evidence: 'OFP FL004 = 400 FT ≤ 500 FT' }];
    const { c, run } = setup({ cached: true, response: { weights: { 676: { plan_no: '123' } }, limit_warns: { 676: yellow } } });
    await run();
    expect(c.flights[0]?.limit_warns).toEqual(yellow);
  });
  it('invalidates the result when aircraft identity changes without accepting an old response', async () => {
    let finish: ((value: unknown) => void) | undefined;
    const { c, run } = setup({ cached: true, fetch: () => new Promise(resolve => { finish = resolve; }) });
    const running = run(true);
    c.flights = [{ ...flight(), reg: 'VN-A677' }]; c.allFlights = [...c.flights]; c.wSeq++;
    await Promise.resolve(); await Promise.resolve();
    if (!finish) throw new Error('OFP request did not start');
    finish({ weights: { 676: { plan_no: '123' } }, limit_warns: { 676: red } });
    await running;
    expect(c.flights[0]?.limit_warns).toEqual(pending);
    expect(c.W_CACHE['676']).toBeUndefined();
  });
  it('rejects a changed sector identity even if the table sequence has not changed', async () => {
    let finish: ((value: unknown) => void) | undefined;
    const { c, run } = setup({ cached: true, fetch: () => new Promise(resolve => { finish = resolve; }) });
    const running = run(true);
    c.flights = [{ ...flight(), plan_no: '124', needs_ofp_limit_check: false }]; c.allFlights = [...c.flights];
    await Promise.resolve(); await Promise.resolve();
    if (!finish) throw new Error('OFP request did not start');
    finish({ weights: { 676: { plan_no: '123' } }, limit_warns: { 676: red } });
    await running;
    expect(c.flights[0]?.limit_warns).toEqual(pending);
    expect(c.W_CACHE['676']).toBeUndefined();
  });
  it('does not interpret a mismatched OFP as a successful check', async () => {
    const { c, reads, run } = setup({ cached: true, response: { weights: { 676: { plan_no: '999', cfp_mismatch: true } }, limit_warns: { 676: red } } });
    await run();
    expect(reads).toHaveLength(2);
    expect(c.flights[0]?.limit_warns[0]?.severity).toBe('warning');
    expect(c.flights[0]?.limit_warns[0]?.evidence).toContain('chưa khớp');
  });
  it('shows a download failure without clearing the warning or looping', async () => {
    const { c, reads, run } = setup({ response: { weights: {}, limit_warns: {}, ofp_failed: [676] } });
    await run();
    expect(reads).toHaveLength(2);
    expect(c.flights[0]?.limit_warns[0]?.severity).toBe('warning');
    expect(c.flights[0]?.limit_warns[0]?.evidence).toContain('chưa tải/đọc được');
  });
  it('keeps a missing-OFP state pending rather than claiming a pass', async () => {
    const { c, reads, run } = setup({ response: { weights: {}, limit_warns: {}, no_ofp: [676] } });
    await run();
    expect(reads).toHaveLength(2);
    expect(c.flights[0]?.limit_warns[0]?.evidence).toContain('chưa có OFP');
  });
  it('rechecks on explicit Reload and on updated limit data', async () => {
    const { c, reads, run } = setup({ cached: true });
    await run(); await run(true);
    c.limData = { aircraft: [{ reg: 'VN-A676', limit: 'ALTITUDE LIMITED TO 600 FT' }] };
    await run();
    expect(reads).toHaveLength(3);
    expect(reads[1]).not.toContain('cache=1');
  });
  it('does not add requests for an unrelated flight with already cached weights', async () => {
    const { c, reads, run } = setup({ cached: true });
    c.flights = [{ ...flight(), needs_ofp_limit_check: false, limit_warns: [] }]; c.allFlights = [...c.flights];
    await run();
    expect(reads).toEqual([]);
  });
});