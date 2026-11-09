import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cmpFastClaim, patchCmpDspFastPage } from '../cmp_dsp_fast';

describe('Compare DSP fast start', () => {
  it('skips the duplicate Compare read for the same DSP scope started moments ago', () => {
    const m = new Map([['dispatcher=NGUYEN+THANH+TRI', 1000]]);
    expect(cmpFastClaim(m, 'dispatcher=NGUYEN+THANH+TRI', 3000)).toBe(true);
    expect(m.size).toBe(0);
  });
  it('still runs Compare when the scope differs from the fast read', () => {
    const m = new Map([['dispatcher=NGUYEN+THANH+TRI', 1000]]);
    expect(cmpFastClaim(m, 'dispatcher=PHAN+THANH+HY', 3000)).toBe(false);
  });
  it('still runs Compare when the fast read is older than a minute', () => {
    const m = new Map([['dispatcher=NGUYEN+THANH+TRI', 1000]]);
    expect(cmpFastClaim(m, 'dispatcher=NGUYEN+THANH+TRI', 62000)).toBe(false);
  });
  it('starts Compare from the DSP dropdown before the board finishes loading', () => {
    const html = patchCmpDspFastPage(readFileSync('src/tool/page.html', 'utf8'));
    expect(html).toContain('markDspSelect(); cmpFastStart(); loadFlights(false);');
    expect(html).toContain('!cmpFastClaim(cmpFastStarts, qs(), Date.now())');
  });
});
