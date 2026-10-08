import { describe, expect, it } from 'vitest';
import { apply24h, notamIn24h, parseNotamWhen } from '../notam_check';

describe('FliteBrief 24H window matches original tool', () => {
  const now = new Date('2026-10-08T09:14:00Z');
  it('keeps an ongoing NOTAM', () => {
    expect(notamIn24h({ start: '2026-10-04T21:00:00+00:00', end: '2026-10-10T15:00:00+00:00' }, now)).toBe(true);
  });
  it('excludes a NOTAM starting after 24 hours', () => {
    expect(notamIn24h({ start: '2026-10-12T22:00:00+00:00', end: '2026-10-16T08:30:00+00:00' }, now)).toBe(false);
  });
  it('excludes an expired NOTAM', () => {
    expect(notamIn24h({ end: '2026-10-08T09:13:59Z' }, now)).toBe(false);
  });
  it('includes a start exactly at the 24-hour boundary', () => {
    expect(notamIn24h({ start: '2026-10-09T09:14:00Z' }, now)).toBe(true);
    expect(notamIn24h({ start: '2026-10-09T09:14:01Z' }, now)).toBe(false);
  });
  it('does not drop PERM or unreadable dates speculatively', () => {
    expect(notamIn24h({ end: 'PERM' }, now)).toBe(true);
    expect(notamIn24h({ start: 'unknown' }, now)).toBe(true);
  });
  it('honors explicit timezone offsets', () => {
    expect(parseNotamWhen('2026-10-08T16:14:00+07:00')?.toISOString()).toBe('2026-10-08T09:14:00.000Z');
  });
  it('counts only the retained portal NOTAMs without mutating ALL data', () => {
    const place = { notams: [{ ident: 'ACTIVE', end: 'PERM' }, { ident: 'FUTURE', start: '202610122200' }] };
    const result = apply24h(place, now);
    expect(result.notam_count).toBe(1);
    expect(result.notams_all).toBe(2);
    expect(result.notams).toEqual([place.notams[0]]);
    expect(place.notams).toHaveLength(2);
  });
});