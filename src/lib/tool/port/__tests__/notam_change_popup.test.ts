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
import { bpCleanText, bpFields, bpZ } from '../notam_change_popup';
describe('NOTAM popup decoding', () => {
  const pdf = 'RPLC: APT 2611020442 B5909/26\nQ)RPHI/QMPLC/IV/BO/A/0/999/1511N12033E\nNOT FOR OPERATIONAL USE\nEn-Route Data\nRef: OPS GEN.   29/126\nA)RPLC   B)202611042300  C)202611051100   -   EST\nE)M   RAMP   ACFT   STAND   NR   18\n(REMOVAL   AND\nREPAINTING).';
  it('drops PDF page furniture and collapses spacing', () => {
    const t = bpCleanText(pdf);
    expect(t).not.toContain('NOT FOR OPERATIONAL USE');
    expect(t).not.toContain('OPS GEN');
    expect(t).toContain('E)M RAMP ACFT STAND NR 18 (REMOVAL AND REPAINTING).');
  });
  it('splits lettered fields and flags EST', () => {
    const f = bpFields(bpCleanText(pdf));
    expect(f.a).toBe('RPLC');
    expect(f.b).toBe('202611042300');
    expect(f.c).toBe('202611051100');
    expect(f.est).toBe(true);
    expect(f.e).toMatch(/^M RAMP ACFT STAND NR 18/);
  });
  it('formats 10-digit and 12-digit times', () => {
    expect(bpZ('2611042300')).toBe('04/11 23:00Z');
    expect(bpZ('202611051100')).toBe('05/11 11:00Z');
  });
});
