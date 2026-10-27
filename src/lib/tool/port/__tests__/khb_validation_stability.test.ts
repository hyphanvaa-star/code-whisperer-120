import { describe, expect, it } from 'vitest';
import { stableValidation } from '../khb_payload';

const good = { s: 'good', t: 'Good', h: 'Good' };
const warning = { s: 'warning', t: 'REG: lệch tàu', h: 'REG: lệch tàu' };
const pending = { s: 'pending', t: 'Chưa đủ dữ liệu: OFP', h: 'Đang lấy OFP' };

describe('KHB background validation', () => {
  it('keeps Good while the new comparison is pending', () => {
    expect(stableValidation(good, pending, false)).toBe(good);
  });
  it('keeps a warning while the new comparison is pending', () => {
    expect(stableValidation(warning, pending, false)).toBe(warning);
  });
  it('does not replace a warning with a partial warning', () => {
    expect(stableValidation(warning, { s: 'warning', t: 'FUEL: lệch', h: '' }, false)).toBe(warning);
  });
  it('updates Good to a completed new warning', () => {
    expect(stableValidation(good, warning, true)).toBe(warning);
  });
  it('clears an old warning when a complete comparison is Good', () => {
    expect(stableValidation(warning, good, true)).toBe(good);
  });
  it('never invents Good for a flight without a previous verdict', () => {
    expect(stableValidation(undefined, pending, false)).toBe(pending);
  });
});