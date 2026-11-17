import { describe, expect, it } from 'vitest';
import { cmpAttachMismatch } from '../cmp_sync';

describe('REG AIMS offers a swap when the attached aircraft file is another tail', () => {
  it('Crewlist VN-A643 = FliteBrief VNA643 but file VNA640.pdf → swap A640 → A643', () => {
    expect(cmpAttachMismatch({ excel: 'VN-A643', flite: 'VNA643' }, '640')).toEqual({ changed: true, attach: true, old: 'VN-A640', new: 'VN-A643' });
  });
  it('attached file already on the Crewlist aircraft → no swap', () => {
    expect(cmpAttachMismatch({ excel: 'VN-A643', flite: 'VNA643' }, '643')).toBeNull();
  });
  it('no attached aircraft file or unreadable Crewlist aircraft → no swap', () => {
    expect(cmpAttachMismatch({ excel: 'VN-A643', flite: 'VNA643' }, '')).toBeNull();
    expect(cmpAttachMismatch({ excel: '—', flite: 'VNA643' }, '640')).toBeNull();
  });
  it('FliteBrief on another aircraft is left to the normal aircraft change', () => {
    expect(cmpAttachMismatch({ excel: 'VN-A643', flite: 'VN-A528' }, '640')).toBeNull();
  });
});
