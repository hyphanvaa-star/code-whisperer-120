import { expect, it } from 'vitest';
import { mergeDefectLimits } from '../defect_limits';

it('removes obsolete VN-A644 APU from summary even when previous-report tracking was lost', () => {
  const rows = mergeDefectLimits([
    { reg: 'VN-A644', defect: 'APU INOP', limit: '', source: 'summary' },
    { reg: 'VN-A639', defect: 'LOW EGT', limit: '', source: 'manual' },
  ], [], [{ reg: 'VN-A534', defect: 'VENT AVNCS SYS FAULT', limit: '' }]);
  expect(rows.map(r => r['reg'])).toEqual(['VN-A639', 'VN-A534']);
});

it('records incoming report ownership for the next refresh', () => {
  const rows = mergeDefectLimits([], [], [{ reg: 'VN-A534', defect: 'VENT SKIN VALVE FAULT', limit: '' }]);
  expect(rows[0]?.['source']).toBe('summary');
});

it('preserves explicit user ownership even when the text matches the old report', () => {
  const row = { reg: 'VN-A644', defect: 'APU INOP', limit: '', source: 'manual' };
  expect(mergeDefectLimits([row], [row], [])).toEqual([row]);
});