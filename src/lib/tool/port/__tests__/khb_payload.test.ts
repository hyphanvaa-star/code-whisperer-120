import { describe, expect, it } from 'vitest';
import { payloadPair, rawOmniPay, patchKhbPayloadPage } from '../khb_payload';

const flight = { flt: '774', date: '20/10/2026', dep: 'CXR', arr: 'HAN', std: '15:45', etd: '16:30' };
const rows = [
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:25:00', est_payload: 14770 },
  { digits: '774', dep: 'CXR', arr: 'HAN', std_local: '2026-10-20T15:45:00', est_payload: 15040 },
];

describe('KHB explicit EST download', () => {
  it('keeps OFP payload first and raw Omni EST second', () => {
    expect(payloadPair(15000, 16582)).toBe('15000 / 16582');
  });
  it('does not substitute one source for a missing source', () => {
    expect(payloadPair(null, 16582)).toBe('— / 16582');
    expect(payloadPair(15000, '')).toBe('15000 / —');
  });
  it('fills PLD with the original Omni EST, without rounding or adding 1000', () => {
    expect(rawOmniPay(rows, flight)).toBe('15040');
  });
  it('does not invent PLD when the matching day or route is missing', () => {
    expect(rawOmniPay(rows, { ...flight, date: '21/10/2026' })).toBeNull();
    expect(rawOmniPay(rows, { ...flight, arr: 'SGN' })).toBeNull();
  });
});

const KHB_PAGE = `<span id="appVersion">V 3.00</span>
<style>#wrapFplText .fttbl{width:1760px;min-width:100%}
#wrapFplText .fttbl :is(th,td):nth-child(16){width:100px}</style>
<th>Enroute ALT</th><th>ETP POA</th><th>FL</th>
blank.appendChild(ftBox(pending, "etp_poa", true));
tr.appendChild(ftBox(st, "etp_poa", true));`;

describe('KHB table columns', () => {
  const patched = patchKhbPayloadPage(KHB_PAGE);
  it('replaces ETP POA with a single PLD column', () => {
    expect(patched).toContain('<th class="ft-pld-head" title="EST PLD Omni (kg)">PLD</th><th>FL</th>');
    expect(patched).not.toContain('ETP POA');
  });
  it('has no Validation column left in the table', () => {
    expect(patched).not.toMatch(/Validation/i);
    expect(patched).not.toContain('ftValidationCell');
  });
  it('adds only the PLD cell to blank and data rows', () => {
    expect(patched).toContain('blank.appendChild(ftPldCell(null));');
    expect(patched).toContain('tr.appendChild(ftPldCell(f));');
  });
  it('keeps later column widths pointing at the same columns', () => {
    expect(patched).toContain(':nth-child(16){width:100px}');
    expect(patched).not.toContain(':nth-child(17)');
  });
});

import { khbUtcDay } from '../khb_payload';
describe('KHB UTC day from local Crewlist time', () => {
  it('CXR 00:05 local on 27/10 is 26/10 UTC (1705Z)', () => {
    expect(khbUtcDay('27/10/26', '00:05', '1705')).toBe('20261026');
  });
  it('HND 03:00 local (+9) on 27/10 is 26/10 UTC (1800Z)', () => {
    expect(khbUtcDay('27/10/26', '03:00', '1800')).toBe('20261026');
  });
  it('KIX 09:30 local on 27/10 is 27/10 UTC (0030Z)', () => {
    expect(khbUtcDay('27/10/26', '09:30', '0030')).toBe('20261027');
  });
  it('gives no day when ETD UTC is missing', () => {
    expect(khbUtcDay('27/10/26', '09:30', '')).toBe('');
  });
});
