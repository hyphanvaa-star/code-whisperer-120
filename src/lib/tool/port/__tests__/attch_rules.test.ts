import { describe, it, expect, vi, afterEach } from 'vitest';
import { needsFor, defaultRuleData } from '../attch';

const fl = (dep: string, dest: string, alt = '') => ({ dep_icao: dep, dest_icao: dest, dest_alt1: alt, reg: 'VNA631' } as never);
const titles = (f: never) => needsFor(f, defaultRuleData()).map(n => n.title);
afterEach(() => vi.useRealTimers());

describe('file-add rules from CFP review', () => {
  it('China alternate attaches China files', () => {
    expect(titles(fl('VVTS', 'VHHH', 'ZGGG'))).toContain('CHINA_EFF-20260222_TO-UFN_SOP_CHINA');
  });
  it('ZK/ZM are not mainland China', () => {
    expect(titles(fl('VVNB', 'ZKPY'))).not.toContain('CHINA_EFF-20260222_TO-UFN_SOP_CHINA');
  });
  it('VVCR stops after 29 Nov 2026', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-28T12:00:00Z'));
    expect(titles(fl('VVTS', 'VVCR'))).toContain('VVCR_EFF-20261012_TO-20261028_UNTIL_29NOV');
    vi.setSystemTime(new Date('2026-11-30T12:00:00Z'));
    expect(titles(fl('VVTS', 'VVCR'))).not.toContain('VVCR_EFF-20261012_TO-20261028_UNTIL_29NOV');
  });
  it('WADD to VVNB gets W27 note, reverse does not', () => {
    expect(titles(fl('WADD', 'VVNB'))).toContain('ROUTE-W27-W28-Q9_EFF-20250220_TO-UFN_W27_W28_Q9_NOTE');
    expect(titles(fl('VVNB', 'WADD'))).not.toContain('ROUTE-W27-W28-Q9_EFF-20250220_TO-UFN_W27_W28_Q9_NOTE');
  });
  it('KLAX gets C-band; every flight gets the general notice; aircraft MEL attached', () => {
    const t = titles(fl('RKSI', 'KLAX'));
    expect(t).toContain('FLEET_EFF-20260812_TO-UFN_C-BAND_INTERFERENCE_AND_OPERATIONAL_LIMITATIONS');
    expect(t).toContain('MULTI-SCOPE_EFF-MIXED_TO-MIXED_NOTICE_TO_PILOT_UPDATED_NEW');
    expect(t).toContain('VNA631');
  });
});

import { describe as d2, it as i2, expect as e2 } from "vitest";
import { matchesData, cleanRuleData, defaultRuleData as srvDefaults } from "../notices";
d2("server notice matcher", () => {
  const f = (dep: string, dest: string) => ({ dep_icao: dep, dest_icao: dest, dest_alt1: "", dest_alt2: "", reg: "VN-A814" } as never);
  const ru = { name: "RU", condition: "prefix_touches_alt", values: ["UW", "UN"], files: ["x"], enabled: true } as never;
  i2("Russia prefix matches UWUU and UNKL departures", () => {
    e2(matchesData(ru, f("UWUU", "VVPQ"))).toBe(true);
    e2(matchesData(ru, f("UNKL", "VVCR"))).toBe(true);
    e2(matchesData(ru, f("UACC", "VVCR"))).toBe(false);
  });
  i2("saving region rules is accepted", () => {
    e2(() => cleanRuleData([ru])).not.toThrow();
  });
  i2("defaults include the per-aircraft MEL rule", () => {
    e2(srvDefaults().some((r) => r.condition === "has_reg" && r.files.includes("{REG}"))).toBe(true);
  });
});
