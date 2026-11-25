import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Flight } from '../../core/models';
import type { Ctx } from '../../types';

const mocks = vi.hoisted(() => ({ find: vi.fn(), fetchPdf: vi.fn(), pdfText: vi.fn() }));
vi.mock('../../core/gantts.server', () => ({
  findOperationalFlightById: mocks.find, loadFlights: vi.fn(),
  filterByWindow: vi.fn(), filterByDispatcher: vi.fn(),
}));
vi.mock('../../handlers/briefing_release.server', () => ({ fetchOfpPdf: mocks.fetchPdf, ofpPdfText: mocks.pdfText }));
import { routes } from '../../handlers/notam_tune.server';

const flight = new Flight({ id: 815, callsign: 'VJC815', dep_icao: 'VVTS', dest_icao: 'WSSS',
  std: new Date('2026-11-25T05:10:00Z'), sta: new Date('2026-11-25T07:10:00Z') });
const e = 'DUE TO BAD WX, LARGE SCALE WX DEV (LSWD) APPLIED ON ROUTES\nL642 AND M771 WI HO CHI MINH FIR:\n- L642: FL320, FL360, FL400\n- M771: FL310, FL350, FL390.';
const ofp = '(FPL-VJC815-IS-A321/M-SDE2E3FGHIJ1J2J3J4J5M1RWY/LB1-VVTS0510-N0450F360 NIXIV L642 ESPOB-WSSS0200-WMKK-DOF/261125)';
async function filter() {
  const handler = routes['POST /api/notam/tune'];
  if (!handler) throw new Error('Missing NOTAM tune handler');
  const request = new Request('https://example.test/api/notam/tune', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'track', id: 815,
      places: [{ code: 'VVHM', kind: 'FIR', notams: [{ ident: 'A4543/26', qfir: 'VVHM', scope: 'E',
        start: '2026-11-25 00:52', end: '2026-11-25 10:00', text: `Q)VVHM/QARLT/IV/NBO/E/0/999\nE)${e}`, e_field: e }] }],
      track: [{ name: 'NIXIV', lat: 9.5, lon: 107, fl_ft: 36000, ete_min: 20, fir: 'VVHM' }],
    }) });
  return await handler({ request } as Ctx) as Record<string, unknown>;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(flight);
  mocks.fetchPdf.mockResolvedValue(new TextEncoder().encode(ofp));
  mocks.pdfText.mockResolvedValue(ofp);
});
describe('A4543/26 tune uses the already downloaded sector OFP', () => {
  it('keeps L642 as a confirmed match but not the unflown M771', async () => {
    const result = await filter();
    expect((result['ofp_hits'] as Record<string, string[]>)['VVHM\tA4543/26']).toEqual(['L642']);
    expect(mocks.fetchPdf).toHaveBeenCalledExactlyOnceWith(815);
  });
  it('uses the text extracted from a PDF for the same route match', async () => {
    mocks.fetchPdf.mockResolvedValue(new TextEncoder().encode('%PDF-test'));
    const result = await filter();
    expect((result['ofp_hits'] as Record<string, string[]>)['VVHM\tA4543/26']).toEqual(['L642']);
    expect(mocks.pdfText).toHaveBeenCalledTimes(1);
  });
  it('never invents L642 when OFP is unavailable and no track airway was supplied', async () => {
    mocks.fetchPdf.mockRejectedValue(new Error('OFP unavailable'));
    const result = await filter();
    expect((result['ofp_hits'] as Record<string, string[]>)['VVHM\tA4543/26'] ?? []).toEqual([]);
    expect(result['ok']).toBe(true);
  });
});