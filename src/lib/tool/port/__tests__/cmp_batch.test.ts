import { describe, it, expect } from 'vitest';
import { cmpBatchKindLabel, cmpBatchKindSelect, cmpBatchAviOperation, cmpBatchDetail, cmpBatchPick, cmpBatchRun, cmpVerifyWait, cmpBatchAck, cmpBatchDragSelection, patchCmpBatchPage } from '../cmp_batch';

describe('cmp batch', () => {
  it('skips unticked and duplicate sectors', () => {
    const r = cmpBatchPick([{ sid: '1', label: 'a', detail: '' }, { sid: '2', label: 'b', detail: '', on: false }, { sid: '1', label: 'a2', detail: '' }, { sid: '3', label: 'c', detail: '' }]);
    expect(r.map(x => x.sid)).toEqual(['1', '3']);
  });
  it('Ack all acknowledges selected sectors once without running actions', () => {
    const acked: string[] = [];
    const items = [{sid:'85',label:'VJ85',detail:''}, {sid:'86',label:'VJ86',detail:'',on:false}, {sid:'85',label:'Duplicate',detail:''}, {sid:'87',label:'VJ87',detail:''}];
    const results = cmpBatchAck('msg', items, sid => { acked.push(sid); return true; });
    expect(acked).toEqual(['85', '87']);
    expect(results.map(r => r.ok)).toEqual([true, true]);
  });
  it('never allows Ack all to bypass red-triangle Verify', () => {
    let calls = 0;
    const results = cmpBatchAck('verify', [{sid:'85',label:'VJ85',detail:''}], () => { calls++; return true; });
    expect(calls).toBe(0);
    expect(results).toEqual([]);
  });
  it('keeps unavailable or failed Ack items pending while acknowledging others', () => {
    const results = cmpBatchAck('crew', [{sid:'1',label:'',detail:''}, {sid:'2',label:'',detail:''}, {sid:'3',label:'',detail:''}], sid => {
      if(sid === '1') throw new Error('stale');
      return sid === '3';
    });
    expect(results.map(r => r.ok)).toEqual([false, false, true]);
  });
  it('dragging down checks the continuous range and keeps other ticks', () => {
    expect(cmpBatchDragSelection([true,false,false,false,false], 1, 3, true)).toEqual([true,true,true,true,false]);
  });
  it('dragging up unchecks the continuous range and keeps other ticks', () => {
    expect(cmpBatchDragSelection([true,true,true,true,true], 3, 1, false)).toEqual([true,false,false,false,true]);
  });
  it('dragging back restores ticks outside the shortened range', () => {
    const original = [false,true,false,true];
    expect(cmpBatchDragSelection(original, 0, 3, true)).toEqual([true,true,true,true]);
    expect(cmpBatchDragSelection(original, 0, 1, true)).toEqual([true,true,false,true]);
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
  it('names the message type shown in its own column', () => {
    expect(cmpBatchKindLabel('DLA')).toBe('DLA');
    expect(cmpBatchKindLabel('CHG A/C')).toBe('CHG');
    expect(cmpBatchKindLabel('CHG')).toBe('CHG');
    expect(cmpBatchKindLabel('CHG DLA')).toBe('CHG/DLA');
  });
  it('a type chip ticks only that type', () => {
    expect(cmpBatchKindSelect(['DLA','CHG','CHG/DLA','DLA'], 'DLA')).toEqual([true,false,false,true]);
    expect(cmpBatchKindSelect(['DLA','CHG'], '')).toEqual([true,true]);
  });
  it('AviWeb takes one operation per submit and refuses a DLA + CHG mix', () => {
    expect(cmpBatchAviOperation(['DLA','DLA'])).toBe('DLA');
    expect(cmpBatchAviOperation(['CHG','CHG/DLA'])).toBe('CHG');
    expect(cmpBatchAviOperation(['DLA','CHG'])).toBeNull();
    expect(cmpBatchAviOperation(['DLA','CHG/DLA'])).toBeNull();
    expect(cmpBatchAviOperation([])).toBeNull();
  });
  it('keeps the change text and drops the type and click hint from the detail', () => {
    expect(cmpBatchDetail('Crewlist delay 10:10 → 10:45: DLA · Bấm để soạn điện văn', 'DLA')).toBe('Crewlist delay 10:10 → 10:45');
    expect(cmpBatchDetail('Crewlist đổi tàu VNA536 → VN-A524: CHG A/C · FliteBrief đã lên đúng tàu Crewlist VN-A536 · Bấm để soạn điện văn', 'CHG A/C'))
      .toBe('Crewlist đổi tàu VNA536 → VN-A524\nFliteBrief đã lên đúng tàu Crewlist VN-A536');
  });
  it('injects the batch script once', () => {
    const out = patchCmpBatchPage(patchCmpBatchPage('<html><body></body></html>'));
    expect(out.match(/cmpBatchScript/g)?.length).toBe(1);
    expect(out).not.toContain('__PICK__');
    expect(out).not.toMatch(/__(KIND|KSEL|AVIOP|DETAIL)__/);
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
