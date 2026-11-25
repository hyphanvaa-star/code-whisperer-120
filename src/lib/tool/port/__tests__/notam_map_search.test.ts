import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { nmFindRouteRows, patchNotamMapSearchPage } from '../notam_map_search';

const source = readFileSync('src/tool/page.html', 'utf8');
const patched = patchNotamMapSearchPage(source);
const routes = [
  { name: 'W2', cc: 'VN', pts: [[16, 107], [17, 108]], fixes: ['FIXA', 'FIXB'] },
  { name: 'W2', cc: 'VN', pts: [[18, 109], [19, 110]], fixes: ['FIXC', 'FIXD'] },
  { name: 'W20', cc: 'VN', pts: [[20, 111], [21, 112]], fixes: ['OTHER1', 'OTHER2'] },
  { name: 'W2', cc: 'TH', pts: [[13, 100], [14, 101]], fixes: ['THA', 'THB'] },
];

describe('selected airway geometry', () => {
  it('indexes W2 separately from W20 and other countries, keeping all VN parts disconnected', () => {
    const rows = nmFindRouteRows(routes);
    expect(rows).toHaveLength(3);
    const vn = rows.find(r => r.route === 'W2' && r.cc === 'VN');
    expect(vn?.routeParts).toEqual([
      { pts: [[16, 107], [17, 108]], fixes: ['FIXA', 'FIXB'] },
      { pts: [[18, 109], [19, 110]], fixes: ['FIXC', 'FIXD'] },
    ]);
    expect(rows.find(r => r.cc === 'TH')?.routeParts).toEqual([
      { pts: [[13, 100], [14, 101]], fixes: ['THA', 'THB'] },
    ]);
  });
  it('never draws an inferred connection through a missing coordinate', () => {
    expect(nmFindRouteRows([{ name: 'W2', pts: [[16, 107], null, [18, 109]] }])).toEqual([]);
  });
  it('rejects malformed and single-point geometry without inventing a route', () => {
    expect(nmFindRouteRows([null, { name: 'W2', pts: [[16, 107]] },
      { name: 'W2', pts: [[NaN, 107], [18, 109]] },
      { name: 'W2', pts: [['', 107], [18, 109]] }])).toEqual([]);
  });
});

// Execute the real patched index/search/control, not copies of their behavior.
function runtime(html = patched) {
  const visible = new Set<object>();
  const lines: { pts: unknown; owner: object | undefined }[] = [];
  const markers: { owner: object | undefined }[] = [];
  const listeners: Record<string, (ev: Record<string, unknown>) => void> = {};
  const input = { value: '', addEventListener: (name: string, fn: (ev: Record<string, unknown>) => void) => { listeners[name] = fn; } };
  const form = { addEventListener: (_: string, fn: (ev: Record<string, unknown>) => void) => { listeners['submit'] = fn; } };
  const list = { innerHTML: '', hidden: true, appendChild() {} };
  const map = { hasLayer: (g: object) => visible.has(g), removeLayer: (g: object) => visible.delete(g),
    fitBounds() {}, flyTo() {}, getZoom: () => 7 };
  const group = () => ({ items: [] as unknown[], addTo(m: unknown) { if (m === map) visible.add(this); return this; },
    clearLayers() { this.items = []; } });
  const vn = group(), th = group(), nav = group(), flight = group();
  visible.add(flight);
  const marker = () => {
    const mk = { owner: undefined as object | undefined, addTo(g: object) {
      this.owner = g;
      if (g === map) visible.add(this); else (g as ReturnType<typeof group>).items.push(this);
      return this;
    }, bindTooltip() { return this; }, openTooltip() { return this; } };
    markers.push(mk); return mk;
  };
  const line = (pts: unknown) => {
    const ln = { pts, owner: undefined as object | undefined, getBounds: () => ({ getCenter: () => ({ lat: 17, lng: 108 }) }),
      addTo(g: object) { this.owner = g; (g as ReturnType<typeof group>).items.push(this); return this; } };
    lines.push(ln); return ln;
  };
  const wrap = { innerHTML: '', querySelector: (s: string) => s === 'form' ? form : s === 'input' ? input : list };
  const ctx = vm.createContext({
    nmMap: map, nmFindRows: [], nmFindPin: null, nmAtsGroups: { VN: vn, TH: th }, nmNavGroup: nav,
    nmIcaoCc: () => 'VN', nmAtsEach: (fn: (v: object) => void) => fn({ _vnName: 'W2', _vnCc: 'VN', getBounds: () => ({ getCenter: () => ({ lat: 17, lng: 108 }) }) }),
    esc: (s: string) => s,
    document: { createElement: () => ({ appendChild() {}, addEventListener() {} }) },
    L: { layerGroup: group, circleMarker: marker, polyline: line,
      latLngBounds: () => ({ valid: false, extend() { this.valid = true; }, isValid() { return this.valid; } }),
      DomUtil: { create: () => wrap }, DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {}, stopPropagation() {}, stop() {} },
      control: () => ({ onAdd: () => wrap, addTo() { return this.onAdd(); } }),
    },
  });
  const start = html.indexOf(html.includes('function nmFindRouteRows(') ? 'function nmFindRouteRows(' : 'function nmFindIndex(j){');
  const end = html.indexOf('let nmHitLayers', start);
  vm.runInContext(html.slice(start, end), ctx);
  ctx['nmFindIndex']({ routes });
  const ctlStart = html.indexOf('  const findCtl = L.control(');
  const ctlEnd = html.indexOf('  return nmMap;', ctlStart);
  vm.runInContext(html.slice(ctlStart, ctlEnd), ctx);
  return { ctx, map, visible, vn, th, nav, flight, lines, markers, input, list,
    select: (name: string, cc = 'VN') => {
      const rows = ctx['nmFindRows'] as ReturnType<typeof nmFindRouteRows>;
      const row = rows.find(r => r.route === name && (!r.cc || r.cc === cc));
      if (!row) throw new Error('Search row missing');
      ctx['nmFindGo'](row);
    },
    fire: (event: string) => listeners[event]?.({ preventDefault() {}, key: event === 'keydown' ? 'Escape' : '' }),
  };
}

describe('search layer lifetime and isolation', () => {
  it('reproduces the old W2 search enabling the entire VN layer', () => {
    const r = runtime(source); r.select('W2');
    expect(r.visible.has(r.vn)).toBe(true);
  });
  it('draws only W2 VN and its four fixes without enabling VN/TH/navaids', () => {
    const r = runtime(); r.select('W2');
    expect(r.lines.map(l => l.pts)).toEqual([[[16, 107], [17, 108]], [[18, 109], [19, 110]]]);
    expect(r.markers).toHaveLength(5); // four fixes plus the search pin
    expect(r.visible.has(r.vn)).toBe(false);
    expect(r.visible.has(r.th)).toBe(false);
    expect(r.visible.has(r.nav)).toBe(false);
    expect(r.visible.has(r.flight)).toBe(true);
  });
  it.each(['input', 'search', 'keydown', 'submit'])('%s clears the search group and pin, never user-enabled overlays', event => {
    const r = runtime(); r.visible.add(r.vn); r.visible.add(r.nav); r.select('W2');
    r.input.value = event === 'keydown' ? 'W2' : ''; r.fire(event);
    expect(vm.runInContext('nmFindSearchGroup', r.ctx)).toBeNull();
    expect(r.ctx['nmFindPin']).toBeNull();
    expect(r.visible).toEqual(new Set([r.flight, r.vn, r.nav]));
    expect(r.list.hidden).toBe(true);
    expect(r.input.value).toBe('');
  });
  it('a replacement search removes old W2 geometry before drawing W20', () => {
    const r = runtime(); r.select('W2');
    const old = vm.runInContext('nmFindSearchGroup', r.ctx) as { items: unknown[] };
    r.select('W20');
    expect(r.visible.has(old)).toBe(false);
    expect(old.items).toEqual([]);
    expect(r.lines.at(-1)?.pts).toEqual([[20, 111], [21, 112]]);
    expect(r.visible.has(r.vn)).toBe(false);
  });
  it('selecting the same airway in Thailand draws only the Thailand geometry', () => {
    const r = runtime(); r.select('W2', 'TH');
    expect(r.lines.map(l => l.pts)).toEqual([[[13, 100], [14, 101]]]);
    expect(r.visible.has(r.th)).toBe(false);
  });
  it.each(['Đài', 'Sân bay', 'Waypoint'])('a %s search replaces prior routes without enabling shared layers', kind => {
    const r = runtime(); r.select('W2');
    r.ctx['nmFindGo']({ kind, show: 'TEST', cc: 'TH', lat: 14, lon: 100 });
    expect(vm.runInContext('nmFindSearchGroup', r.ctx)).toBeNull();
    expect(r.ctx['nmFindPin']).not.toBeNull();
    expect(r.visible.has(r.th)).toBe(false);
    expect(r.visible.has(r.nav)).toBe(false);
  });
});