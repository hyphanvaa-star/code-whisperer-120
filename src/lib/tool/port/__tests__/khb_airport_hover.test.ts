import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { patchKhbAirportHoverPage } from '../khb_airport_hover';

describe('KHB combined airport hover', () => {
  const source = readFileSync('src/routes/tool-page.ts', 'utf8');
  const start = source.indexOf('function ftWatchTaf(el, source){');
  const end = source.indexOf('\nfunction ftWatchTaf', start + 1);
  const patched = patchKhbAirportHoverPage(source.slice(start, end > start ? end : undefined));
  const helperStart = patched.indexOf('function ftShowAirportTip');
  const helper = patched.slice(helperStart, patched.indexOf('function ftWatchTaf',helperStart));
  it.each(['dep','arr','talt','alt1','alt2'])('retains current %s limits with weather', (role) => {
    const tip = document.createElement('div');
    let current = [{sev:'critical',why:role + ' HUI restriction'}];
    const el = {_ftAirportLimits:() => current};
    const context = {document, tafTipEl:() => tip, moveTafTip:() => {},
      showTafTip:() => {tip.textContent='TAF VVPC';},
      showLimitTip:(_:unknown,meta:string,limits:{text:string}[]) => {tip.textContent=meta + limits.map(x=>x.text).join('');}};
    runInNewContext(helper + ';ftShowAirportTip({},el,{},"missing")',{...context,el});
    expect(tip.textContent).toBe('Giới hạn sân bay' + role + ' HUI restrictionTAF VVPC');
    current=[];
    runInNewContext(helper + ';ftShowAirportTip({},el,null,"missing")',{...context,el});
    expect(tip.textContent).toBe('TAF VVPC');
  });
});