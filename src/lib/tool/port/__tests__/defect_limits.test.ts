import { describe, expect, it } from 'vitest';
import { mergeDefectLimits } from '../defect_limits';
import defaults from '../../data/limits.json';
describe('summary preserves maintained limits', () => {
  const egt = { reg: 'VN-A522', defect: 'LOW EGT', limit: '' };
  const manual = { reg: 'VN-A631', defect: 'MANUAL DEFECT', limit: 'NO CAT 3' };
  const old = { reg: 'VN-A810', defect: 'OLD REPORT DEFECT', limit: '' };
  const fresh = { reg: 'VN-A810', defect: 'NEW REPORT DEFECT', limit: '' };
  it('keeps LOW EGT even from previous report', () => {
    expect(mergeDefectLimits([egt, old], [egt, old], [fresh])).toEqual([egt, fresh]);
  });
  it('keeps manual defects and replaces old report rows', () => {
    expect(mergeDefectLimits([manual, old], [old], [fresh])).toEqual([manual, fresh]);
  });
  it('keeps user edits to report rows', () => {
    const edited = { ...old, limit: 'USER LIMIT' };
    expect(mergeDefectLimits([edited], [old], [fresh])).toEqual([edited, fresh]);
  });
  it('does not reinsert deleted A649 LOW EGT', () => {
    expect(mergeDefectLimits([egt], [], [fresh]).map(r => r['reg'])).toEqual(['VN-A522', 'VN-A810']);
  });
  it('deduplicates repeated report loads', () => {
    expect(mergeDefectLimits([egt, fresh], [fresh], [fresh, fresh])).toEqual([egt, fresh]);
  });
  it('restores thirteen original LOW EGT registrations excluding A649', () => {
    expect(defaults.aircraft.filter(r => /LOW\s+EGT/i.test(r.defect) && r.reg !== 'VN-A649').map(r => r.reg)).toEqual([
      'VN-A522', 'VN-A631', 'VN-A632', 'VN-A634', 'VN-A635', 'VN-A637', 'VN-A639',
      'VN-A641', 'VN-A642', 'VN-A643', 'VN-A651', 'VN-A657', 'VN-A687',
    ]);
  });
});
