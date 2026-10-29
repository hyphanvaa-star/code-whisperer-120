import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchCmpHandoverPage } from '../cmp_handover';

describe('Compare handover render', () => {
  const html = patchCmpHandoverPage(readFileSync('src/tool/page.html', 'utf8'));
  function render(rows: { sector_id: number; callsign: string; handover: boolean }[]) {
    const document = globalThis.document.implementation.createHTMLDocument();
    document.body.innerHTML = '<table><thead id="cmpHead"></thead><tbody id="cmpBody"></tbody></table><div id="count"></div>';
    const td = () => document.createElement('td');
    const context = { document, $: (s: string) => document.querySelector(s),
      CMP_HEAD: [['CALLSIGN', '']], current: null, stopLoading() {}, paintEstBang() {},
      txtCell: (v: string) => { const el = td(); el.textContent = v; return el; },
      routeCmpCell: td, timeCell: td, crewCell: td, regCmpCell: td,
      markDsp: (el: unknown) => el, altCmpCell: td,
      mk: () => document.createElement('span'), fillWeights() {}, fillEst() {}, fillCrew() {},
      jumpExcelToFlight() {},
    };
    vm.createContext(context);
    const start = html.indexOf('function renderCompareTable(d, opts){');
    const end = html.indexOf('/* Ô CREW', start);
    vm.runInContext(html.slice(start, end), context);
    vm.runInContext(`renderCompareTable({table:${JSON.stringify(rows)}})`, context);
    return document;
  }
  it('renders the primary DSP first row without handover', () => {
    const doc = render([{ sector_id: 642, callsign: 'VJC642', handover: false }]);
    expect(doc.querySelectorAll('#cmpBody tr')).toHaveLength(1);
    expect(doc.querySelector('#cmpBody tr')?.textContent).toContain('VJC642');
  });
  it('renders both groups with exactly one separator between them', () => {
    const doc = render([
      { sector_id: 430, callsign: 'VJC430', handover: true },
      { sector_id: 431, callsign: 'VJC431', handover: true },
      { sector_id: 642, callsign: 'VJC642', handover: false },
    ]);
    const rows = [...doc.querySelectorAll('#cmpBody tr')];
    expect(rows).toHaveLength(4);
    expect(rows[2]?.className).toBe('cmp-sep');
    expect(rows[3]?.textContent).toContain('VJC642');
  });
});