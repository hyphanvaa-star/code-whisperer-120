import { describe, it, expect } from 'vitest';
import { cmpBatchPick, cmpBatchRun, cmpVerifyWait, patchCmpBatchPage } from '../cmp_batch';

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
  it('verify waits for a slow job start instead of reporting failure', async () => {
    // job id arrives only after a few ticks, then the job runs, then ends green
    let tick = 0;
    const ok = await cmpVerifyWait(() => {
      tick++;
      return { busy: true, job: tick >= 4 && tick < 10, done: tick >= 10, ended: tick >= 10 };
    }, async () => {}, 1e9, 1e9, 0);
    expect(ok).toBe(true);
    expect(tick).toBeGreaterThanOrEqual(10);
  });
  it('verify reports failure when the job ends without success', async () => {
    let tick = 0;
    const ok = await cmpVerifyWait(() => {
      tick++;
      return { busy: tick < 6, job: tick >= 2 && tick < 6, done: false, ended: false };
    }, async () => {}, 1e9, 1e9, 0);
    expect(ok).toBe(false);
  });
  it('verify that never starts reports failure after the start timeout', async () => {
    const ok = await cmpVerifyWait(() => ({ busy: true, job: false, done: false, ended: false }), () => new Promise(r => setTimeout(r, 5)), 30, 1e9, 5);
    expect(ok).toBe(false);
  });
  it('injects the verify wait helper', () => {
    const out = patchCmpBatchPage('<html><body></body></html>');
    expect(out).not.toContain('__VWAIT__');
  });
});
