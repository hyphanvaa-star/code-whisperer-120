import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { crewlistKeepsTab, patchCrewlistTabKeepPage } from '../crewlist_tab_keep';

describe('new Crewlist keeps the tab in use', () => {
  it('stays on NOTAM Tracking and other working tabs', () => {
    for (const tab of ['notam', 'fpltext', 'tool', 'limits', 'notice_rules', 'handover', 'aftn']) {
      expect(crewlistKeepsTab(tab)).toBe(true);
    }
  });

  it('still shows the result when Flight Supervisor is already open', () => {
    for (const tab of ['compare', 'general', 'version']) expect(crewlistKeepsTab(tab)).toBe(false);
  });

  it('patches the upload path of the original page', () => {
    const raw = readFileSync('src/tool/page.html', 'utf8');
    const out = patchCrewlistTabKeepPage(raw);
    expect(out).toContain('if(crewlistKeepsTab(mode)){ try{ Promise.resolve(runCompare())');
    expect(out).toContain('else if(!crewlistKeepsTab(mode)) setMode("version");');
    expect(out).not.toContain('    }else{\n      setMode("compare");\n    }\n  }catch(err){');
  });
});
