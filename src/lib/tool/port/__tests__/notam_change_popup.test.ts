import { describe, expect, it } from 'vitest';
import { bpPackDetails, bpNotamDetails, bpUnseenAfter } from '../notam_change_popup';

describe('NOTAM popup records', () => {
  it('keeps each missing PDF body with its location and number', () => {
    const rows=bpPackDetails('RJJJ: FIR 2611041230 X6798/26 Q) FIR E) AREA ACTIVE\nROAH: APT 2611041230 H4113/26 B) 2611041000 E) RWY CLSD');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({loc:'RJJJ',id:'X6798/26',text:'RJJJ: FIR 2611041230 X6798/26 Q) FIR E) AREA ACTIVE'});
    expect(rows[1].text).toContain('E) RWY CLSD');
  });
  it('does not mix identical IDs at different locations or duplicate source rows', () => {
    const places=[{code:'RJJJ',notams:[{ident:'X6798/26',text:'Japan',level:'CRITICAL',reasons:['route']}],notams_src:[{ident:'X6798/26',text:'Japan'}]},{code:'ROAH',notams:[{ident:'X6798/26',text:'Okinawa'}]}];
    expect(bpNotamDetails(places,[{loc:'ROAH',id:'X6798/26'}])).toEqual([{loc:'ROAH',id:'X6798/26',text:'Okinawa',level:undefined,reasons:[]}]);
    expect(bpNotamDetails(places,[{id:'X6798/26'}])).toHaveLength(2);
  });
  it('retains dropped NOTAM full text and reports missing content without inventing it', () => {
    expect(bpNotamDetails([{code:'ROAH',dropped:[{ident:'H4113/26',text:'E) RWY CLSD'}]}],[{id:'H4113/26'},{id:'A0001/26'}]).map(n=>n.text)).toEqual(['E) RWY CLSD','']);
  });
  it('acknowledges only the list actually opened, preserving later new NOTAMs', () => {
    expect(bpUnseenAfter({ids:['X6798/26','H4113/26'],at:123},['X6798/26'])).toEqual({ids:['H4113/26'],at:123});
    expect(bpUnseenAfter({ids:['X6798/26']},['X6798/26'])).toBeNull();
  });
});