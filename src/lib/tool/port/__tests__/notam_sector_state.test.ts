import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nmSectorKey, patchNotamSectorStatePage } from '../notam_sector_state';
import { patchNotamProcedureHighlightPage } from '../notam_procedure_highlight';

const source = readFileSync('src/tool/page.html', 'utf8');
const html = patchNotamSectorStatePage(patchNotamProcedureHighlightPage(source)
  .replace('if(nmTrackData) nmTrackCache[id] = nmTrackData;', 'if(nmTrackData){ nmTrackCache[id] = nmTrackData; try{ window.bpSaveBase && window.bpSaveBase(id, nmTrackData); }catch(_e){} }'));
const flights = [
  { id: 1883, callsign: 'VJC1883', dep: 'SGN', dest: 'BKK', std: '2026-11-25T15:00:00Z', reg: 'VN-A901' },
  { id: 902, callsign: 'VJC902', dep: 'BKK', dest: 'SGN', std: '2026-11-25T17:00:00Z', reg: 'VN-A902' },
];
const row = { ident: 'A3448/26', text: 'ATS ROUTE Y27 W2 CLSD', ofp_hits: ['Y27'], ofp_body_hits: ['Y27'],
  sid_star_hits: [{ procs: ['DALAP'] }], sid_star_hit_names: ['DALAP'],
  reasons: ['Chuyến bay trên ATS route Y27 nêu trong NOTAM'], level: 'CRITICAL' };
function pack(index = 0) {
  const f = flights[index]; if (!f) throw new Error('Flight missing');
  return { flight: { ...f }, track: [], hits: [], tuned: true, _sectorKey: nmSectorKey(f),
    places: [{ code: 'VTBB', kind: 'FIR', notams: [structuredClone(row)], notams_src: [structuredClone(row)] }] };
}

function runtime() {
  const elements = new Map<string, { value: string; title: string; textContent: string; hidden: boolean; innerHTML: string; disabled: boolean; setAttribute(): void; classList: { add(): void; remove(): void } }>();
  const el = (key: string) => {
    let e = elements.get(key);
    if (!e) { e = { value: '', title: '', textContent: '', hidden: false, innerHTML: '', disabled: false, setAttribute() {}, classList: { add() {}, remove() {} } }; elements.set(key, e); }
    return e;
  };
  el('#nmFlt').value = '1883';
  const reads: { url: string; body: Record<string, unknown> | null; resolve(value: unknown): void }[] = [];
  let renders = 0, wipes = 0;
  const alerts: string[] = [];
  const ctx = vm.createContext({
    $, nmTrackData: pack(), nmData: { places: pack().places }, nmTrackCache: {},
    nmPick: 'VTBB', nmFocusIdent: 'A3448/26', nmShowDropped: false, nmGroup: 'TRACK', NM_GROUP_TRACK: 'TRACK', NM_GROUP_ALL: 'ALL',
    nmAwyPick: 'Y27', nmAwyPickId: '1883', nmFleetSum: false, nmBatch: false, nmBatchLbl: '', nmScrollDots: false,
    mode: '', window: { bpSaveBase() {} }, BOARD_BACK_H: 6, BOARD_AHEAD_H: 24,
    nmPickedFlight: () => flights.find(f => String(f.id) === el('#nmFlt').value),
    nmWipeMapChrome: () => { wipes++; }, nmSyncActiveMap() {}, nmFltSyncQ() {}, nmFltFillItems() {}, nmMultiLabel() {},
    nmRender: () => { renders++; }, nmGetShow() {}, nmAssessCfg: () => ({}), nmCritIdents: () => new Set(),
    nmNotamN: (p: ReturnType<typeof pack>) => p.places.reduce((n, place) => n + place.notams.length, 0),
    alert: (s: string) => alerts.push(s), AbortController, URLSearchParams,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    fetch: (url: string, init?: { body?: string }) => new Promise(resolve => {
      reads.push({ url, body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : null, resolve: value => resolve({ json: async () => value }) });
    }),
  });
  function $(key: string) { return el(key); }
  ctx['nmDrawTrack'] = (d: unknown) => { ctx['nmTrackData'] = d; };
  function runRange(start: string, end: string) {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    if (a < 0 || b <= a) throw new Error(`Missing source range: ${start}`);
    vm.runInContext(html.slice(a, b), ctx);
  }
  runRange('function nmSectorKey(', 'const nmMulti =');
  runRange('async function nmTrackAll(', 'let nmBatchLbl =');
  runRange('async function nmTrackOne(){', 'function nmSlimPlaces(');
  runRange('function nmSlimPlaces(', 'function nmCritIdents(');
  // Include the body-highlighting helpers used by the real apply function.
  runRange('function nmSidHitNames(', 'function nmSidStarRows(');
  runRange('function nmApplyTune(', 'function nmUndoTune(');
  runRange('async function nmRunTune(', 'const NM_ASSESS_KEY');
  return { ctx, reads, alerts, el, pick: (id: string) => ctx['nmFltPick'](id),
    eval: (s: string) => vm.runInContext(s, ctx) as unknown,
    get renders() { return renders; }, get wipes() { return wipes; } };
}
async function tick() { await new Promise(resolve => setTimeout(resolve, 0)); }

describe('NOTAM flight ownership', () => {
  it('VJC1883 → VJC902 clears the previous active result without erasing fleet data', () => {
    const r = runtime(); const fleet = r.ctx['nmData'];
    r.pick('1883'); r.ctx['nmTrackData'] = pack(); r.pick('902');
    expect(r.ctx['nmTrackData']).toBeNull();
    expect(r.eval('nmSectorWaiting()')).toBe(true);
    expect(r.ctx['nmData']).toBe(fleet);
    expect(r.ctx['nmAwyPick']).toBe(''); expect(r.wipes).toBe(2);
  });
  it('restores only VJC1883 completed cache as a detached snapshot', () => {
    const r = runtime(); const cached = pack(); r.ctx['nmTrackCache']['1883'] = cached;
    r.pick('1883'); expect(r.ctx['nmTrackData']).toEqual(cached);
    expect(r.ctx['nmTrackData']).not.toBe(cached);
    expect(r.eval('nmSectorWaiting()')).toBe(false);
  });
  it.each(['std', 'dep', 'dest', 'reg'])('rejects cache if the same ID now has different %s', field => {
    const r = runtime(); const cached = pack();
    cached._sectorKey = nmSectorKey({ ...cached.flight, [field]: 'changed' });
    r.ctx['nmTrackCache']['1883'] = cached; r.pick('1883');
    expect(r.ctx['nmTrackData']).toBeNull(); expect(r.eval('nmSectorWaiting()')).toBe(true);
  });
  it('does not transfer Y27/DALAP computed hits in a new tune request', () => {
    const r = runtime(); const output = r.ctx['nmSlimPlaces'](pack().places);
    expect(output[0].notams[0].ofp_hits).toEqual([]);
    expect(output[0].notams[0].sid_star_hits).toEqual([]);
    expect(output[0].notams[0].sid_star_hit_names).toEqual([]);
    expect(output[0].notams[0].text).toBe('ATS ROUTE Y27 W2 CLSD');
  });
  it('tune stamps W2 on a detached sector, leaving the shared Y27 source and prior cache intact', () => {
    const r = runtime(); const first = pack(), second = { ...pack(1), places: first.places };
    const original = structuredClone(first);
    r.ctx['nmApplyTune'](second, {}, { ofp_hits: { 'VTBB\tA3448/26': ['W2'] }, sid_star_hits: {}, assess: { 'VTBB\tA3448/26': { level: 'BRIEFING INFO', reasons: [] } } });
    expect(first).toEqual(original);
    expect(second.places[0]?.notams[0]?.ofp_hits).toEqual(['W2']);
    expect(second.places[0]?.notams_src[0]?.sid_star_hits).toEqual([]);
  });
  it('rejects a VJC1883 track response arriving after selecting VJC902, even after returning to VJC1883', async () => {
    const r = runtime(); const request = r.ctx['nmTrackOne']();
    r.pick('902'); r.pick('1883'); r.reads[0]?.resolve(pack()); await request;
    expect(r.ctx['nmTrackData']).toBeNull(); expect(r.reads).toHaveLength(1);
    expect(r.ctx['nmTrackCache']).toEqual({});
  });
  it('rejects a VJC1883 tune arriving after VJC902 selection', async () => {
    const r = runtime(); r.pick('1883'); r.ctx['nmTrackData'] = pack();
    const request = r.ctx['nmRunTune']('track', r.el('#nmTuneTrk'), 'Lọc');
    r.pick('902'); r.reads[0]?.resolve({ ofp_hits: { 'VTBB\tA3448/26': ['Y27'] } }); await request;
    expect(r.ctx['nmTrackData']).toBeNull(); expect(r.ctx['nmTrackCache']).toEqual({});
  });
  it('refuses to filter an active pack for a different flight', async () => {
    const r = runtime(); r.el('#nmFlt').value = '902';
    await r.ctx['nmRunTune']('track', r.el('#nmTuneTrk'), 'Lọc');
    expect(r.reads).toHaveLength(0); expect(r.alerts).toHaveLength(1);
  });
  it('newer same-sector tune wins over a late older filter', async () => {
    const r = runtime(); r.pick('1883'); r.ctx['nmTrackData'] = pack();
    const old = r.ctx['nmRunTune']('track', r.el('#nmTuneTrk'), 'Lọc');
    const fresh = r.ctx['nmRunTune']('track', r.el('#nmTuneTrk'), 'Lọc');
    r.reads[1]?.resolve({ ofp_hits: { 'VTBB\tA3448/26': ['W2'] }, sid_star_hits: {} }); await fresh;
    r.reads[0]?.resolve({ ofp_hits: { 'VTBB\tA3448/26': ['Y27'] } }); await old;
    expect(r.ctx['nmTrackData'].places[0].notams[0].ofp_hits).toEqual(['W2']);
  });
  it('tracking VJC902 completes, reads W2 back, and caches it only under 902', async () => {
    const r = runtime(); r.pick('902'); const request = r.ctx['nmTrackOne']();
    r.reads[0]?.resolve(pack(1)); await tick();
    expect(r.alerts).toEqual([]);
    expect(r.reads).toHaveLength(2);
    expect(r.reads[1]?.body?.['id']).toBe(902);
    r.reads[1]?.resolve({ ofp_hits: { 'VTBB\tA3448/26': ['W2'] }, sid_star_hits: {}, assess: { 'VTBB\tA3448/26': { level: 'NEED MANUAL CHECK', reasons: [] } } });
    await request;
    expect(r.ctx['nmTrackCache']['902'].flight.id).toBe(902);
    expect(r.ctx['nmTrackCache']['902'].places[0].notams[0].ofp_hits).toEqual(['W2']);
    expect(r.ctx['nmTrackCache']['1883']).toBeUndefined();
    expect(r.eval('nmSectorWaiting()')).toBe(false);
  });
  it('batch tracking keeps 1883/Y27 and 902/W2 separate and restores the first selected sector', async () => {
    const r = runtime();
    const request = r.ctx['nmTrackAll']('', ['1883', '902']);
    r.reads[0]?.resolve(pack()); await tick();
    r.reads[1]?.resolve({ ofp_hits: { 'VTBB\tA3448/26': ['Y27'] }, sid_star_hits: {} }); await tick();
    r.reads[2]?.resolve(pack(1)); await tick();
    r.reads[3]?.resolve({ ofp_hits: { 'VTBB\tA3448/26': ['W2'] }, sid_star_hits: {} });
    await request;
    expect(r.ctx['nmTrackCache']['1883'].places[0].notams[0].ofp_hits).toEqual(['Y27']);
    expect(r.ctx['nmTrackCache']['902'].places[0].notams[0].ofp_hits).toEqual(['W2']);
    expect(r.ctx['nmTrackData'].flight.id).toBe(1883);
    expect(r.alerts).toEqual([]);
  });
});