import { describe, expect, it } from 'vitest';
import { cmpSwapReport } from '../cmp_sync';

const L = (...t: string[]) => t.map(text => ({ text }));

describe('aircraft swap popup names the exact FliteBrief result', () => {
  it('old file deleted but new MEL missing → shows both, with the missing file name', () => {
    const r = cmpSwapReport(L('✓ đã xoá VNA640.pdf  (tàu cũ)', '! thiếu file "VNA643" trên đĩa — chưa đính kèm được'), true);
    expect(r).toContain('✓ Đã xoá: VNA640.pdf');
    expect(r).toContain('✗ Chưa thêm được: VNA643 — thiếu file trong kho MEL/notice');
  });
  it('no delete permission → says the FliteBrief account cannot delete', () => {
    expect(cmpSwapReport(L('✗ tài khoản không có quyền XOÁ attachment'), true)).toContain('không có quyền xoá file cũ');
  });
  it('new file added but old one could not be deleted', () => {
    const r = cmpSwapReport(L('✗ không xoá được VNA640.pdf', '✓ đã thêm VNA643  (MEL)'), true);
    expect(r).toContain('✓ Đã thêm: VNA643');
    expect(r).toContain('✗ Chưa xoá được: VNA640.pdf');
  });
  it('upload error keeps the FliteBrief reason', () => {
    expect(cmpSwapReport(L('✗ thêm VNA643: HTTP 500'), true)).toContain('VNA643 — FliteBrief báo: HTTP 500');
  });
  it('lost connection is reported as such', () => {
    expect(cmpSwapReport([], false)).toContain('Mất kết nối');
  });
});
