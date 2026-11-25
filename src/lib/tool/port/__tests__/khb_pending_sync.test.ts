import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { patchKhbCrewSyncPage } from '../khb_crew_sync';

const html = patchKhbCrewSyncPage(readFileSync('src/tool/page.html', 'utf8'));
const syncStart = html.indexOf('function ftFbSync(');
const sync = html.slice(syncStart, html.indexOf('setInterval(', syncStart));
const okStart = html.indexOf('function ftChgOk(');
const ok = html.slice(okStart, html.indexOf('function ftBoltPaint(', okStart));

type Change = { from: string; to: string; src: string; fbOk?: boolean; done?: boolean };
async function readBack(response: Record<string, unknown>, mutate?: (state: State) => void) {
  const flight = { id: 849, flt: '849', date: '25/11/26', dep: 'SGN', arr: 'DAD', reg: 'VN-A580' };
  const state = { ...flight, etd: '18:00', utc: '11:00', etaUtc: '12:00', chgFb: false, regFb: false,
    chg: { reg: { from: 'VN-A648', to: 'VN-A580', src: 'crew' }, etd: { from: '17:00', to: '18:00', src: 'both' },
      cptText: { from: '0859 OLD', to: '15399 NEW', src: 'crew' }, foText: { from: '1234 OLD', to: '7390 NEW', src: 'fpl' } } as Record<string, Change> };
  let job: (() => Promise<void>) | undefined;
  let saved = 0;
  const context = { ftRows: [flight], ftSt: () => state, ftFbState: {}, ftFbT: 0,
    ftFbKey: () => '849|25/11/26|SGN|DAD|VN-A580', ftFbPaint() {}, ftRepaintChg() {},
    ftKeepLater() { saved++; }, clearTimeout() {}, setTimeout(fn: () => Promise<void>) { job = fn; },
    fetch: async () => { mutate?.(state); return { json: async () => ({ items: [response] }) }; } };
  runInNewContext(sync + ';ftFbSync(true)', context);
  if (!job) throw new Error('FliteBrief read was not scheduled');
  await job();
  return { state, saved };
}
type State = { chg: Record<string, Change>; utc: string; etd: string; reg: string };
const correct = { found: true, reg: 'VN-A580', std_utc: '1100', crew_checked: true,
  crew_changes: [{ key: 'cptText', from: '0859 OLD', to: '15399 NEW', ok: true },
    { key: 'foText', from: '1234 OLD', to: '7390 NEW', ok: true }] };

describe('pending KHB per-cell FliteBrief read-back', () => {
  it('only turns green after the exact changed aircraft, time and pilots read back correctly', async () => {
    const { state, saved } = await readBack(correct);
    for (const key of ['reg', 'etd', 'cptText', 'foText']) expect(state.chg[key]?.fbOk).toBe(true);
    expect(saved).toBe(1);
  });
  it('correct aircraft never hides pending time or either pilot', async () => {
    const { state } = await readBack({ ...correct, std_utc: '1000', crew_checked: false });
    expect(state.chg['reg']?.fbOk).toBe(true);
    for (const key of ['etd', 'cptText', 'foText']) expect(state.chg[key]?.fbOk).toBe(false);
  });
  it('missing FliteBrief time never proves the delay is complete', async () => {
    const { state } = await readBack({ ...correct, std_utc: '' });
    expect(state.chg['etd']?.fbOk).toBe(false);
  });
  it('a missing sector never acknowledges any changed cell', async () => {
    const { state } = await readBack({ found: false });
    for (const key of ['reg', 'etd', 'cptText', 'foText']) expect(state.chg[key]?.fbOk).toBe(false);
  });
  it('a late read of the previous target never acknowledges the new target', async () => {
    const { state } = await readBack(correct, st => {
      st.reg = 'VN-A683';
      st.chg['reg'] = { from: 'VN-A580', to: 'VN-A683', src: 'crew', fbOk: false };
    });
    expect(state.chg['reg']?.fbOk).toBe(false);
    expect(state.regFb).toBe(false);
  });
  it('manual aircraft matching FliteBrief does not complete a different pending target', async () => {
    const response = { ...correct, reg: 'VN-A554' };
    const { state } = await readBack(response);
    expect(state.chg['reg']?.fbOk).toBe(false);
  });
  it('explicit per-cell failure overrides old done or row-level green flags', () => {
    expect(runInNewContext(ok + ';ftChgOk({chgFb:true,regFb:true}, {key:"reg",done:true,fbOk:false})')).toBe(false);
    expect(runInNewContext(ok + ';ftChgOk({chgFb:true}, {key:"etd"})')).toBe(false);
    expect(runInNewContext(ok + ';ftChgOk({chgFb:true}, {key:"cptText"})')).toBe(false);
  });
});