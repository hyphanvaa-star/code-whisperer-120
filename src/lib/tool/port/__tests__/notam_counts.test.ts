import { describe, expect, it } from 'vitest';
import { notamCounts } from '../notam_counts';

describe('NOTAM overview counts', () => {
  it('includes manual and briefing in total but not IMPACT or NO IMPACT', () => {
    expect(notamCounts({ places: [{ notams: [
      {ident:'A',level:'CRITICAL'}, {ident:'B',level:'DELAY-ONLY'},
      {ident:'C',level:'NEED MANUAL CHECK'}, {ident:'D',level:'BRIEFING INFO'},
    ], dropped:[{ident:'E',level:'NO IMPACT'}] }] })).toEqual({total:5,impact:2,noimpact:1});
  });
  it('does not double count a row in both displayed and filtered arrays', () => {
    const row = {ident:'A',level:'NO IMPACT'};
    expect(notamCounts({places:[{notams:[row],dropped:[row]}]})).toEqual({total:1,impact:0,noimpact:1});
  });
  it('counts an empty flight as zero', () => {
    expect(notamCounts(null)).toEqual({total:0,impact:0,noimpact:0});
  });
});