import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { wxMark, patchKhbAirportWxPage } from '../khb_airport_wx';
import { patchKhbAirportHoverPage } from '../khb_airport_hover';

describe('KHB airport weather warning', () => {
  it('bad TAF is red with reason', () => {
    const m = wxMark({ status: 'bad', when: '22:25Z', why: 'TEMPO: dông/TSRA' });
    expect(m.level).toBe('bad');
    expect(m.why).toContain('dông/TSRA');
  });
  it('NIL or outside TAF validity is orange', () => expect(wxMark({ status: 'nil' }).level).toBe('nil'));
  it('missing TAF is grey', () => expect(wxMark({ status: 'missing' }).level).toBe('missing'));
  it('good weather is not marked', () => expect(wxMark({ status: 'ok' }).level).toBe(''));
  it('patch applies to the hover-patched tool page', () => {
    let html = readFileSync('src/tool/page.html', 'utf8')
      .replace('function ftWatchTaf(el, pack){', 'function ftWatchTaf(el, source){\n  const pack = typeof source === "function" ? source() : source;');
    html = patchKhbAirportWxPage(patchKhbAirportHoverPage(html));
    expect(html).toContain('el._ftWxSrc');
    expect(html).toContain('function ftWxPaint');
    expect(html).toContain('ft-wx-sum');
  });
});
