import { describe, expect, it } from 'vitest';
import { assessedVerdict } from '../notam_summary';
import { classifyEffect, type Verdict } from '../notam_verdict';

const base: Verdict = { status: 'wait', sections: [
  { key: 'rwy', hit: true, rows: [{ label: 'RJBB', icao: 'RJBB', ident: 'B2961/26', value: '06R/24L' }] },
  { key: 'area', hit: false, groups: [] },
] };
const notices = [
  { ident: 'J2241/26', qsubj: 'MR', qcond: 'LC', e_field: 'RWY 16L/34R CLOSED', level: 'CRITICAL' },
  { ident: 'J2240/26', qsubj: 'MR', qcond: 'LC', e_field: 'RWY 04/22 CLOSED', level: 'DELAY-ONLY' },
];
describe('Post-assessment NOTAM summary', () => {
  it('adds both missing RJTT closures to the stale RJBB-only verdict', () => {
    const v = assessedVerdict(base, [{ code: 'RJTT', kind: 'A', notams: notices }], classifyEffect);
    expect(v.sections[0].rows?.map(r => [r.icao, r.ident, r.value])).toEqual([
      ['RJBB', 'B2961/26', '06R/24L'], ['RJTT', 'J2241/26', '16L/34R'], ['RJTT', 'J2240/26', '04/22'],
    ]);
    expect(v.sections[1].hit).toBe(false);
    expect(v.status).toBe('wait');
  });
  it('removes only the no-impact notice, preserving the other runway and other airport', () => {
    const first = assessedVerdict(base, [{ code: 'RJTT', kind: 'A', notams: notices }], classifyEffect);
    const v = assessedVerdict(first, [{ code: 'RJTT', kind: 'A', notams: [notices[1]],
      dropped: [{ ...notices[0], level: 'NO IMPACT' }] }], classifyEffect);
    expect(v.sections[0].rows?.map(r => r.ident)).toEqual(['B2961/26', 'J2240/26']);
  });
  it('does not infer FIR route impact from critical place severity without a geometry-safe verdict', () => {
    const v = assessedVerdict(base, [{ code: 'RJJJ', kind: 'FIR', notams: [
      { ident: 'J9000/26', qsubj: 'WM', e_field: 'LIVE FIRING', level: 'CRITICAL' },
    ] }], classifyEffect);
    expect(v.sections[1].groups).toEqual([]);
    expect(v.sections[1].hit).toBe(false);
  });
  it('keys no-impact grades by airport plus notice and updates overall status', () => {
    const v = assessedVerdict(base, [{ code: 'RJTT', dropped: [{ ident: 'B2961/26', level: 'NO IMPACT' }] }], classifyEffect);
    expect(v.sections[0].rows).toHaveLength(1);
    const cleared = assessedVerdict(base, [{ code: 'RJBB', dropped: [{ ident: 'B2961/26', level: 'NO IMPACT' }] }], classifyEffect);
    expect(cleared.sections[0].hit).toBe(false);
    expect(cleared.status).toBe('clear');
  });
});