import { describe, expect, it } from 'vitest';
import { normalizeToolTab, TOOL_TAB_BY_BUTTON_ID, toolTabUrl } from '../tab_launcher';

describe('tool tab deep links', () => {
  it('opens NOTAM Tracking directly in a new browser tab', () => {
    expect(toolTabUrl('mNotam')).toBe('/tool?tab=notam');
  });

  it('keeps each visible operational tab on its own existing button', () => {
    expect(TOOL_TAB_BY_BUTTON_ID).toMatchObject({
      mFplText: 'fpltext', mHandover: 'handover', mCompare: 'compare',
      mTool: 'tool', mLimits: 'limits', mNoticeRules: 'notice_rules',
      mDatabase: 'database', opsAcctManage: 'accounts',
    });
  });

  it('does not expose hidden legacy tabs through deep links', () => {
    for (const id of ['mGeneral', 'mVer', 'mFpl', 'mAtcCheck', 'mAftn']) {
      expect(toolTabUrl(id)).toBe('');
    }
  });

  it('falls back to the normal start tab for an unknown or missing target', () => {
    expect(normalizeToolTab(undefined)).toBe('');
    expect(normalizeToolTab('unknown')).toBe('');
    expect(normalizeToolTab('mNotam')).toBe('');
    expect(normalizeToolTab(' NOTAM ')).toBe('notam');
  });
});
