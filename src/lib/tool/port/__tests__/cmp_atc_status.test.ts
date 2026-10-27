import { describe, expect, it } from 'vitest';
import { cmpAtcStatus } from '../cmp_validation';

describe('Compare AviWeb status identity', () => {
  it('shows the status for the selected flight date', () => {
    expect(cmpAtcStatus({ callsign: 'VJC807', dof: '261027', status: 'FILED' }, 'VJC807', '261027')).toBe('FILED');
  });
  it('never uses yesterday or missing source DOF', () => {
    expect(cmpAtcStatus({ callsign: 'VJC807', dof: '261026', status: 'FILED' }, 'VJC807', '261027')).toBe('');
    expect(cmpAtcStatus({ callsign: 'VJC807', status: 'FILED' }, 'VJC807', '261027')).toBe('');
  });
  it('rejects another flight and failed reads', () => {
    expect(cmpAtcStatus({ callsign: 'VJC808', dof: '261027', status: 'FILED' }, 'VJC807', '261027')).toBe('');
    expect(cmpAtcStatus({ callsign: 'VJC807', dof: '261027', status: 'FILED', error: 'Read failed' }, 'VJC807', '261027')).toBe('');
  });
});