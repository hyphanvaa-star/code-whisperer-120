import { expect, it, vi } from 'vitest';
import type { Ctx } from '../../types';
import { saveDefectSummary } from '../../defect-limits.server';

const state = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../store.server', () => ({
  getJson: async (_ctx: unknown, key: string, fallback: unknown) => state.get(key) ?? fallback,
  setJson: async (_ctx: unknown, key: string, value: unknown) => { state.set(key, value); },
}));

it('saves fresh report, removes obsolete A644 APU, and keeps LOW EGT and user notes through repeated refresh', async () => {
  state.clear();
  state.set('limits', { aircraft: [
    { reg: 'VN-A644', defect: 'APU INOP', source: 'summary' },
    { reg: 'VN-A639', defect: 'LOW EGT', source: 'manual' },
    { reg: 'VN-A644', defect: 'USER NOTE', source: 'manual' },
  ], airports: [{ code: 'VVPC' }] });
  const summary = { aircraft: [{ reg: 'VN-A534', defect: 'VENT AVNCS SYS FAULT', limit: '' }] };
  const ctx = {} as Ctx;
  const first = await saveDefectSummary(ctx, summary);
  expect(first.map(r => r['defect'])).toEqual(['LOW EGT', 'USER NOTE', 'VENT AVNCS SYS FAULT']);
  expect(state.get('limits')).toEqual({ aircraft: first, airports: [{ code: 'VVPC' }] });
  expect(state.get('defect.summary')).toEqual(summary);
  expect(await saveDefectSummary(ctx, summary)).toEqual(first);
});