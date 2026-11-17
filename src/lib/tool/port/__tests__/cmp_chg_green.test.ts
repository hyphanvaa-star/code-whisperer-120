import { describe, expect, it } from 'vitest';
import { cmpChgFbReady } from '../cmp_sync';

describe('CHG turns green when FliteBrief carries the Crewlist aircraft', () => {
  it('FliteBrief VN-A668 = Crewlist VN-A668 → green', () => {
    expect(cmpChgFbReady({ excel: 'VN-A668', flite: 'VN-A668' }, 'VN-A668', false)).toBe(true);
  });
  it('FliteBrief still VN-A528 while Crewlist is VN-A668 → stays red', () => {
    expect(cmpChgFbReady({ excel: 'VN-A668', flite: 'VN-A528' }, 'VN-A668', false)).toBe(false);
  });
  it('Crewlist disagrees with the CHG target aircraft → stays red', () => {
    expect(cmpChgFbReady({ excel: 'VN-A528', flite: 'VN-A528' }, 'VN-A668', false)).toBe(false);
  });
  it('fresh FliteBrief OFP read already on the new aircraft → green', () => {
    expect(cmpChgFbReady({ excel: 'VN-A668', flite: 'VN-A528' }, 'VN-A668', true)).toBe(true);
  });
  it('missing aircraft on either side never counts as matched', () => {
    expect(cmpChgFbReady({ excel: '—', flite: '' }, '', false)).toBe(false);
    expect(cmpChgFbReady(null, 'VN-A668', false)).toBe(false);
  });
});
