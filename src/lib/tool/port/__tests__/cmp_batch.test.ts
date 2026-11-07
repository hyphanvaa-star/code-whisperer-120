import { describe, it, expect } from 'vitest';
import { cmpBatchPick, cmpBatchRun, patchCmpBatchPage } from '../cmp_batch';

describe('cmp batch', () => {
  it('skips unticked and duplicate sectors', () => {
    const r = cmpBatchPick([{ sid: '1', label: 'a', detail: '' }, { sid: '2', label: 'b', detail: '', on: false }, { sid: '1', label: 'a2', detail: '' }, { sid: '3', label: 'c', detail: '' }]);
    expect(r.map(x => x.sid)).toEqual(['1', '3']);
  });
  it('runs sequentially and a failure does not stop the rest', async () => {
    const order: string[] = [];
    const res = await cmpBatchRun([{ sid: '1', label: '', detail: '' }, { sid: '2', label: '', detail: '' }, { sid: '3', label: '', detail: '' }], async it => {
      order.push(it.sid);
      if (it.sid === '2') throw new Error('boom');
      return { ok: true };
    });
    expect(order).toEqual(['1', '2', '3']);
    expect(res.map(r => r.ok)).toEqual([true, false, true]);
    expect(res[1].note).toBe('boom');
  });
  it('injects the batch script once', () => {
    const out = patchCmpBatchPage(patchCmpBatchPage('<html><body></body></html>'));
    expect(out.match(/cmpBatchScript/g)?.length).toBe(1);
    expect(out).not.toContain('__PICK__');
  });
});
