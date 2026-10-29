import { describe, expect, it } from 'vitest';
import { cmpAircraftChange, cmpPilotChanges, cmpSourceChange } from '../cmp_sync';

describe('Compare source changes', () => {
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
  });
});