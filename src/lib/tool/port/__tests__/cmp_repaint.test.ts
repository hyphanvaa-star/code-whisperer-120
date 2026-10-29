import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { patchCmpValidationPage } from '../cmp_validation';

const html = patchCmpValidationPage(readFileSync('src/tool/page.html', 'utf8'));

describe('Compare incremental updates', () => {
  it('fills one REG cell without repainting unrelated sectors', () => {
    const start = html.indexOf('function fillRegCell(');
    const end = html.indexOf('function regCmpCell(', start);
    const context = { document, cmpBind: {}, cmpArmPick() {}, regTimeCell: () => document.createElement('span'),
      cmpRegRepaint: () => { throw new Error('Full-table repaint during cell fill'); } };
    vm.createContext(context);
    vm.runInContext(html.slice(start, end), context);
    vm.runInContext('fillRegCell(document.createElement("td"), null, false, "VNA657", 64200)', context);
  });

  it('repaints only the sectors supplied by a completed check batch', () => {
    const touched: number[] = [];
    const rows = Array.from({ length: 50 }, (_, i) => ({ sector_id: i }));
    const context = { lastCmp: { table: rows },
      cmpSyncPaint: (r: { sector_id: number }) => touched.push(r.sector_id), cmpMsgPaint() {} };
    vm.createContext(context);
    const start = html.indexOf('function cmpSyncRepaint(');
    const end = html.indexOf('async function cmpSyncOpen', start);
    vm.runInContext(html.slice(start, end), context);
    vm.runInContext('cmpSyncRepaint(lastCmp.table.slice(10,14))', context);
    expect(touched).toHaveLength(12);
    expect([...new Set(touched)]).toEqual([10, 11, 12, 13]);
  });

  it('indexes rows once per result and replaces the index on a fresh result', () => {
    let reads = 0;
    const rows = Array.from({ length: 50 }, (_, i) => ({ get sector_id() { reads++; return i; } }));
    const context = { lastCmp: { table: rows } };
    vm.createContext(context);
    const start = html.indexOf('let cmpSyncRowSource');
    const end = html.indexOf('function cmpSyncEvidence', start);
    vm.runInContext(html.slice(start, end), context);
    vm.runInContext('for(let i=0;i<50;i++) cmpSyncRow(i)', context);
    expect(reads).toBe(50);
    const fresh = { sector_id: 100 };
    context.lastCmp.table = [fresh];
    expect(vm.runInContext('cmpSyncRow(100)', context)).toBe(fresh);
    expect(vm.runInContext('cmpSyncRow(1)', context)).toBeUndefined();
  });
});