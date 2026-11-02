import { describe, expect, it } from 'vitest';
import { cmpAircraftChange, cmpFplPair, cmpPilotChanges, cmpSourceChange } from '../cmp_sync';

describe('Compare source changes', () => {
  const now = Date.parse('2026-11-02T08:53:00Z');
  it('uses VER 10 versus VER 09 even when VER 01 is uploaded last', () => {
    const old = {name:'FLIGHT PLAN ON 02NOV - VER 09.xlsx',modified:100};
    const latest = {name:'FLIGHT PLAN ON 02NOV - VER 10.xlsx',modified:200};
    const lateUpload = {name:'FLIGHT PLAN ON 02NOV - VER 01.xlsx',modified:300};
    expect(cmpFplPair([lateUpload,latest,old],now)).toEqual([old,latest]);
  });
  it('does not compare revisions from different flight dates', () => {
    const yesterday = {name:'FLIGHT PLAN ON 01NOV - VER 20.xlsx'};
    const latest = {name:'FLIGHT PLAN ON 02NOV - VER 02.xlsx'};
    const old = {name:'FLIGHT PLAN ON 02NOV - VER 01.xlsx'};
    expect(cmpFplPair([yesterday,old,latest],now)).toEqual([old,latest]);
    expect(cmpFplPair([yesterday,latest],now)).toEqual([]);
  });
  it('skips duplicate copies of the same VER', () => {
    const old = {name:'FLIGHT PLAN ON 02NOV - VER 09.xlsx'};
    const latest = {name:'FLIGHT PLAN ON 02NOV - VER 10.xlsx',modified:20};
    expect(cmpFplPair([{...latest,modified:10},latest,old],now)).toEqual([old,latest]);
  });
  it('keeps January newer than December at the year boundary', () => {
    const old = {name:'FLIGHT PLAN ON 01JAN - VER 01.xlsx'};
    const latest = {name:'FLIGHT PLAN ON 01JAN - VER 02.xlsx'};
    expect(cmpFplPair([{name:'FLIGHT PLAN ON 31DEC - VER 25.xlsx'},latest,old],Date.parse('2027-01-01T08:00:00Z'))).toEqual([old,latest]);
  });
  const row = {sector_id:64200,fb_std:'2026-10-29T08:00:00Z',reg:{changed:true,old:'VN-A648',new:'VN-A657'}};
  it('enables only actual old-to-new aircraft changes', () => {
    expect(cmpAircraftChange(row.reg)).toBe(true);
    expect(cmpAircraftChange({...row.reg,old:'VNA657'})).toBe(false);
    expect(cmpAircraftChange({...row.reg,changed:false})).toBe(false);
  });
  it('requires the exact sector and date, never a Crewlist row ID', () => {
    expect(cmpSourceChange([row],64200,row.fb_std)).toEqual(row);
    expect(cmpSourceChange([row],300,row.fb_std)).toBeNull();
    expect(cmpSourceChange([row],64200,'2026-10-28T08:00:00Z')).toBeNull();
    expect(cmpSourceChange([row,row],64200,row.fb_std)).toBeNull();
  });
  it('swaps identifiable changed pilots only and retains unchanged FO', () => {
    expect(cmpPilotChanges('(CPT) 1234; (FO) 5678','(CPT) 4321; (FO) 5678')).toEqual([{key:'cptText',from:'1234',to:'4321'}]);
    expect(cmpPilotChanges('(CPT) 1234','(DHD CPT) 4321')).toEqual([]);
    expect(cmpPilotChanges('unknown','unknown')).toEqual([]);
    expect(cmpPilotChanges('(CPT) 1234','(CPT) 4321; (CPT) 5555; (CPT) 6666')).toEqual([]);
  });
});