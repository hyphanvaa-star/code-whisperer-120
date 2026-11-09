import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { patchCmpSyncPage } from '../cmp_sync';

const page = patchCmpSyncPage('function renderCompareTable(d, opts){');
const slice = (from: string, to: string) => { const a = page.indexOf(from); return page.slice(a, page.indexOf(to, a)); };

describe('Compare FliteBrief check after a new Crewlist', () => {
  it('checks every changed flight on the table in one request, not one request per flight', async () => {
    const bodies: Array<{ items: Array<{ sector_id: number }> }> = [];
    const context: Record<string, unknown> = {
      CMP_SYNC_CHUNK: 20, cmpSyncChecks: new Map(),
      cmpSyncKey: (e: { f: { id: number }; kind: string }) => e.f.id + e.kind,
      cmpSyncIdentity: (e: { f: { id: number } }) => ({ sector_id: e.f.id }),
      fetch: async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body); bodies.push(body);
        return { ok: true, json: async () => ({ ok: true, items: body.items.map((it: { sector_id: number }) => ({ found: true, sector_id: it.sector_id, reg: 'VN-A668', reg_atch: '668' })) }) };
      },
    };
    vm.createContext(context);
    vm.runInContext(slice('async function cmpSyncCheckMany', 'function cmpSyncWrapText'), context);
    const list = Array.from({ length: 12 }, (_, i) => ({ f: { id: 100 + i }, kind: 'aims', row: { reg: { new: 'VN-A668' } }, changes: [] }));
    await vm.runInContext('cmpSyncCheckMany', context)(list);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.items).toHaveLength(12);
    expect((context.cmpSyncChecks as Map<string, { ok: boolean }>).get('111aims')?.ok).toBe(true);
  });

  it('never marks a flight matched when FliteBrief cannot be read', async () => {
    const context: Record<string, unknown> = {
      CMP_SYNC_CHUNK: 20, cmpSyncChecks: new Map(),
      cmpSyncKey: (e: { f: { id: number } }) => String(e.f.id),
      cmpSyncIdentity: (e: { f: { id: number } }) => ({ sector_id: e.f.id }),
      fetch: async () => ({ ok: false, json: async () => ({ error: 'down' }) }),
    };
    vm.createContext(context);
    vm.runInContext(slice('async function cmpSyncCheckMany', 'function cmpSyncWrapText'), context);
    await vm.runInContext('cmpSyncCheckMany', context)([{ f: { id: 1 }, kind: 'aims', row: { reg: { new: 'VN-A668' } }, changes: [] }]);
    expect((context.cmpSyncChecks as Map<string, unknown>).size).toBe(0);
  });

  it('starts the Crewlist comparison right after the upload is saved', () => {
    const html = patchCmpSyncPage('function renderCompareTable(d, opts){\n    crewStat("");\n    lastCmp = null; xlsData = null;\n    await acLoadRegContext();');
    expect(html).toContain('lastCmp = null; xlsData = null;\n    if(typeof cmpReadSyncSources === "function") cmpReadSyncSources();\n    await acLoadRegContext();');
  });
});
