import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { cmpAviOperation } from '../cmp_sync';
import { patchCmpValidationPage } from '../cmp_validation';

const html = patchCmpValidationPage(readFileSync('src/tool/page.html', 'utf8'));
const flight = { id: 84901, callsign: 'VJC849', std: '2026-11-25T10:00:00Z' };
const row = { sector_id: 84901, callsign: 'VJC849', dep: 'VVTS', arr: 'VTBS', crew_std: '17:00', crew_etd: '17:45' };

function element<T extends Element>(selector: string): T {
  const e = document.querySelector<T>(selector);
  if (!e) throw new Error('Missing test element: ' + selector);
  return e;
}

function setup(available = true) {
  document.body.innerHTML = '<table><tbody id="cmpBody"><tr></tr></tbody></table>';
  const avi = vi.fn(async () => {}), review = vi.fn(), ack = vi.fn();
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ kind: 'DLA', flights: [row] }) }));
  const alert = vi.fn();
  const context = vm.createContext({ document, window: { __aviwebOpen: avi }, cmpAviOperation,
    cmpActionFlight: () => available ? flight : null, cmpAtcCache: new Map(), cmpAtcKey: () => '849',
    r: row, actionFlight: flight, fetch, alert, ftOpenAtcReview: review });
  const chooseStart = html.indexOf('function cmpMessageChoose(');
  const chooseEnd = html.indexOf('function cmpActionFlight(r)', chooseStart);
  if (chooseStart >= 0 && chooseEnd > chooseStart) vm.runInContext(html.slice(chooseStart, chooseEnd), context);
  const start = html.indexOf('    const messageCell = document.createElement("td");');
  const end = html.indexOf('    tr.append(messageCell, briefCell, verifyCell);', start);
  if (start < 0 || end < start) throw new Error('Message handler missing');
  vm.runInContext(html.slice(start, end) + '\ndocument.querySelector("tr").appendChild(messageCell);', context);
  const twoStart = html.indexOf('function cmpTwoOpen(b)');
  const twoEnd = html.indexOf('document.addEventListener("click", ev => {', twoStart);
  if (twoStart < 0 || twoEnd < twoStart) throw new Error('Channel handler missing');
  context['cmpTwoClose'] = () => {};
  vm.runInContext(html.slice(twoStart, twoEnd), context);
  const menu = element<HTMLSelectElement>('select');
  function openQuick(kind: string) {
    const b = document.createElement('button');
    b.className = 'cmp-msg-quick'; b.textContent = kind;
    Object.assign(b, { _cmpAck: ack, _cmpMessageOpen: (channel: string) => vm.runInContext(
      'document.querySelector("select")._cmpMessageOpen(' + JSON.stringify(kind) + ',' + JSON.stringify(channel) + ')', context) });
    b.onclick = () => { vm.runInContext('document.querySelector("select")._cmpMessageOpen(' + JSON.stringify(kind) + ',"AMHS")', context); };
    menu.before(b);
    vm.runInContext('cmpTwoOpen(document.querySelector(".cmp-msg-quick"))', context);
  }
  return { context, avi, review, fetch, alert, ack, menu, openQuick };
}

describe('Compare message channel selection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) {
      this.open = false; this.dispatchEvent(new Event('close'));
    } });
  });
  it.each(['CHG', 'CHG A/C', 'CHG DLA'])('%s uses the CHG sender including current EOBT', kind => {
    expect(cmpAviOperation(kind)).toBe('CHG');
  });
  it('DLA uses the delay sender, not CHG', () => expect(cmpAviOperation('DLA')).toBe('DLA'));
  it.each(['CHG ALT', 'CHG ROUTE', 'CNL', 'FPL'])('%s cannot use the AviWeb CHG/DLA sender', kind => {
    expect(cmpAviOperation(kind)).toBeNull();
  });
  it('DLA AviWeb opens only the clicked sector without preparing AMHS or acknowledging', async () => {
    const s = setup(); s.openQuick('DLA');
    element<HTMLButtonElement>('.cmp-two-avi').click();
    await vi.waitFor(() => expect(s.avi).toHaveBeenCalledWith('DLA', [{ sector_id: 84901, flt: 'VJC849', date: '2026-11-25', dep: 'VVTS', arr: 'VTBS' }]));
    expect(s.fetch).not.toHaveBeenCalled(); expect(s.ack).not.toHaveBeenCalled();
  });
  it('CHG DLA opens a CHG plan for this sector', async () => {
    const s = setup(); s.openQuick('CHG DLA');
    element<HTMLButtonElement>('.cmp-two-avi').click();
    await vi.waitFor(() => expect(s.avi).toHaveBeenCalledWith('CHG', [{ sector_id: 84901, flt: 'VJC849', date: '2026-11-25', dep: 'VVTS', arr: 'VTBS' }]));
  });
  it('AMHS prepares the existing text review and never calls AviWeb', async () => {
    const s = setup(); s.openQuick('DLA');
    element<HTMLButtonElement>('.cmp-two-go:not(.cmp-two-avi)').click();
    await vi.waitFor(() => expect(s.review).toHaveBeenCalledOnce());
    const call = s.fetch.mock.calls[0] as unknown[] | undefined;
    expect(call?.[0]).toBe('/api/fpltext/msg');
    const options = call?.[1] as { body: string } | undefined;
    if (!options) throw new Error('No message request');
    const payload = JSON.parse(options.body);
    expect(payload.kind).toBe('DLA'); expect(payload.items[0].sector_id).toBe(84901);
    expect(payload.items[0].etd_local).toBe('17:45');
    expect(s.avi).not.toHaveBeenCalled(); expect(s.ack).not.toHaveBeenCalled();
  });
  it('Ack only acknowledges the warning, never prepares or sends a message', () => {
    const s = setup(); s.openQuick('DLA');
    element<HTMLButtonElement>('.cmp-two-ack').click();
    expect(s.ack).toHaveBeenCalledOnce(); expect(s.fetch).not.toHaveBeenCalled(); expect(s.avi).not.toHaveBeenCalled();
  });
  it.each(['DLA', 'CHG A/C', 'CHG DLA'])('manual %s waits for a channel choice without preparing or acknowledging', async kind => {
    const s = setup(); s.menu.value = kind;
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    expect(s.fetch).not.toHaveBeenCalled(); expect(s.avi).not.toHaveBeenCalled(); expect(s.ack).not.toHaveBeenCalled();
  });
  it('manual DLA sends the clicked sector to AviWeb only after choosing AviWeb', async () => {
    const s = setup(); s.menu.value = 'DLA';
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    element<HTMLButtonElement>('#cmpMessageChannel [data-channel="AviWeb"]').click();
    await vi.waitFor(() => expect(s.avi).toHaveBeenCalledWith('DLA', [{ sector_id: 84901, flt: 'VJC849', date: '2026-11-25', dep: 'VVTS', arr: 'VTBS' }]));
    expect(s.fetch).not.toHaveBeenCalled(); expect(s.ack).not.toHaveBeenCalled();
  });
  it('manual CHG DLA prepares the existing AMHS text only after choosing AMHS', async () => {
    const s = setup(); s.menu.value = 'CHG DLA';
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    element<HTMLButtonElement>('#cmpMessageChannel [data-channel="AMHS"]').click();
    await vi.waitFor(() => expect(s.review).toHaveBeenCalledOnce());
    const call = s.fetch.mock.calls[0] as unknown[] | undefined;
    const options = call?.[1] as { body: string } | undefined;
    if (!options) throw new Error('No message request');
    const payload = JSON.parse(options.body);
    expect(payload.kind).toBe('CHG DLA'); expect(payload.items[0].sector_id).toBe(84901);
    expect(s.avi).not.toHaveBeenCalled(); expect(s.ack).not.toHaveBeenCalled();
  });
  it('closing the manual choice does not prepare, send, or acknowledge a message', async () => {
    const s = setup(); s.menu.value = 'DLA';
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    element<HTMLButtonElement>('#cmpMessageChannel [data-close]').click();
    expect(s.fetch).not.toHaveBeenCalled(); expect(s.avi).not.toHaveBeenCalled(); expect(s.ack).not.toHaveBeenCalled();
  });
  it('manual channel choice rechecks the flight instead of reusing a stale sector', async () => {
    const s = setup(); s.menu.value = 'DLA';
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    s.context['cmpActionFlight'] = () => null;
    element<HTMLButtonElement>('#cmpMessageChannel [data-channel="AviWeb"]').click();
    await vi.waitFor(() => expect(s.alert).toHaveBeenCalledOnce());
    expect(s.fetch).not.toHaveBeenCalled(); expect(s.avi).not.toHaveBeenCalled();
  });
  it.each(['CHG ALT', 'CHG ROUTE', 'CNL'])('manual %s keeps the AMHS-only path', async kind => {
    const s = setup(); s.menu.value = kind;
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    expect(s.review).toHaveBeenCalledOnce(); expect(s.avi).not.toHaveBeenCalled();
    const call = s.fetch.mock.calls[0] as unknown[] | undefined;
    const options = call?.[1] as { body: string } | undefined;
    if (!options) throw new Error('No message request');
    expect(JSON.parse(options.body).kind).toBe(kind);
  });
  it.each(['DLA', 'CHG'])('manual %s AviWeb selection targets the same row', async kind => {
    const s = setup(); s.menu.value = kind + ' AviWeb';
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    expect(s.avi).toHaveBeenCalledWith(kind, [{ sector_id: 84901, flt: 'VJC849', date: '2026-11-25', dep: 'VVTS', arr: 'VTBS' }]);
    expect(s.fetch).not.toHaveBeenCalled();
  });
  it('rechecks the live operational sector at action time and blocks a missing flight', async () => {
    const s = setup(false); s.menu.value = 'DLA AviWeb';
    await vm.runInContext('document.querySelector("select").onchange()', s.context);
    expect(s.avi).not.toHaveBeenCalled(); expect(s.fetch).not.toHaveBeenCalled(); expect(s.alert).toHaveBeenCalledOnce();
  });
});

describe('AviWeb explicit sector versus KHB ticks', () => {
  function editorSetup() {
    const script = readFileSync('src/tool/aviweb-editor.js', 'utf8');
    const start = script.indexOf('  window.__aviwebOpen =');
    const end = script.indexOf('  const menu =', start);
    const request = vi.fn(async (_path: string, body: { operation: string }) => ({ operation: body.operation, content: '' }));
    const picked = vi.fn(() => [{ flt: '999', date: '2026-11-25', dep: 'VVDN', arr: 'RKSI' }]);
    const context = vm.createContext({ window: {}, request, ftPickedItems: picked, uid: () => 'tester',
      alert: vi.fn(), core: { parse: () => [] }, clearTimeout, fitDialog() {}, controls() {}, render() {}, status: async () => {}, error() {},
      el: () => ({}), dialog: { open: false, showModal() {} },
      plan: null, messages: [], index: 0, reviewed: false, submitting: false, job: false, timer: null, owner: 'tester', activeOp: '', loading: false });
    if (start < 0 || end < start) throw new Error('Editor opener missing');
    vm.runInContext(script.slice(start, end), context);
    return { context, request, picked };
  }
  it('an explicit Compare sector never includes flights ticked in KHB', async () => {
    const s = editorSetup();
    await vm.runInContext('window.__aviwebOpen("DLA", [{sector_id:84901,flt:"VJC849",date:"2026-11-25",dep:"VVTS",arr:"VTBS"}])', s.context);
    expect(s.request).toHaveBeenCalledWith('/api/atc/aviweb/plan', { operation: 'DLA', items: [{ sector_id: 84901, flt: 'VJC849', date: '2026-11-25', dep: 'VVTS', arr: 'VTBS' }] });
    expect(s.picked).not.toHaveBeenCalled();
  });
  it('an empty explicit selection never falls back to KHB ticks', async () => {
    const s = editorSetup(); await vm.runInContext('window.__aviwebOpen("DLA", [])', s.context);
    expect(s.request).not.toHaveBeenCalled(); expect(s.picked).not.toHaveBeenCalled();
  });
  it('KHB keeps its existing tick selection when no explicit sector is supplied', async () => {
    const s = editorSetup(); await vm.runInContext('window.__aviwebOpen("CHG")', s.context);
    expect(s.request).toHaveBeenCalledWith('/api/atc/aviweb/plan', { operation: 'CHG', items: [{ flt: '999', date: '2026-11-25', dep: 'VVDN', arr: 'RKSI' }] });
  });
  it('cannot silently replace a clicked Compare flight with a different running job', async () => {
    const s = editorSetup();
    vm.runInContext('job=true; plan={}; timer=1;', s.context);
    await expect(vm.runInContext('window.__aviwebOpen("DLA", [{flt:"VJC849"}])', s.context)).rejects.toThrow('đang chạy');
    expect(s.request).not.toHaveBeenCalled(); expect(s.picked).not.toHaveBeenCalled();
  });
});