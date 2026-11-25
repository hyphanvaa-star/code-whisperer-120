import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reqOfpAlternates } from '../req_ofp_alternates';
import { Db, build_req, req_bytes } from '../fpl_tool';

const atc = (alts: string, talt = '') => `(FPL-VJC1342-IS\n-A321/M-S\n-VVPC0200\n-N0450F330 DCT\n-VVTS0100${alts ? ' ' + alts : ''}\n-PBN/A1 DOF/261125 REG/VNA580${talt ? ' TALT/' + talt : ''}\n-E/0300)`;
const db = new Db({flights:[{row:1,flt:'1342',dep:'UIH',arr:'SGN',reg:'VN-A580',ac:321,etd:'09:00'}],
  etp:[['UIHSGN','HANDLI','','','HANDLI']]}, {altRoutesDoc:{routes:[{podpoa:'UIHSGN',alt1:'HAN',alt2:'DLI',talt:'DAD'}]}});
const build = (ofp: string, block: string) => build_req(db,[{id:1,pay:'13750',extra:'20M',...reqOfpAlternates(ofp,block,'VVTS')}],'OLD DSP',[]);

describe('REQ alternates are mandatory OFP sources', () => {
  it('takes ALT1/ALT2 and TALT from OFP instead of the route defaults', () => {
    const block=atc('VVCR VVCT','VVDN');
    const fields=reqOfpAlternates('ALT1 VVCR/CXR TIME 00.20\nALT2 VVCT/VCA TIME 00.30',block,'VVTS');
    expect(fields).toEqual({alt1:'CXR',alt2:'VCA',talt:'DAD',alternate_source:'ofp'});
    const text=build_req(db,[{id:1,...fields}],'OLD DSP',[]);
    expect(text.split('\n').find(l=>l.startsWith('HLD÷'))).toBe('HLD÷30,CXR/SGNCXR1/100/300,VCA/SGNVCA1/100/300');
    expect(text.split('\n').find(l=>l.startsWith('POD÷'))).toContain(',ALT=DAD,');
  });
  it('does not require TIME to read alternate identity', () => {
    expect(reqOfpAlternates('ALT1 VVCR/CXR\nALT2 VVCT/VCA',atc('VVCR VVCT'),'VVTS').alt2).toBe('VCA');
  });
  it('keeps ALT2 and TALT absent when the OFP has only ALT1', () => {
    const text=build('ALT1 VVCR/CXR',atc('VVCR'));
    expect(text.split('\n').find(l=>l.startsWith('HLD÷'))).toBe('HLD÷30,CXR/SGNCXR1/100/300');
    expect(text.split('\n').find(l=>l.startsWith('POD÷'))).not.toContain(',ALT=');
  });
  it('reads a wrapped item 16 from the same OFP when ALT DATA is absent', () => {
    expect(reqOfpAlternates('',atc('VVCR\n VVCT'),'VVTS')).toMatchObject({alt1:'CXR',alt2:'VCA'});
  });
  it('an explicit no-alternate ATC plan never falls back to ETP defaults', () => {
    const text=build('',atc(''));
    expect(text.split('\n').find(l=>l.startsWith('HLD÷'))).toBe('HLD÷30,');
    expect(text.split('\n').find(l=>l.startsWith('POD÷'))).not.toContain(',ALT=');
  });
  it('blocks an unreadable OFP instead of substituting defaults', () => {
    expect(()=>reqOfpAlternates('EST PLD 13750','unreadable','VVTS')).toThrow('chưa xác định được Alternate');
  });
  it('blocks inconsistent alternate identities inside the same OFP', () => {
    expect(()=>reqOfpAlternates('ALT1 VVCR/CXR',atc('VVNB'),'VVTS')).toThrow('khác giữa ALT DATA và ATC Plan');
    expect(()=>reqOfpAlternates('ALT1 VVCR/HAN',atc('VVCR'),'VVTS')).toThrow('không khớp');
  });
  it('blocks unknown alternate codes without guessing IATA', () => {
    expect(()=>reqOfpAlternates('',atc('ZZZZ'),'VVTS')).toThrow('chưa xác định được mã IATA');
  });
  it('retains KHB manual alternate export behavior', () => {
    const text=build_req(db,[{id:1,alt1:'DLI',alt2:'HAN',talt:'CXR'}],'KHB DSP',[]);
    expect(text.split('\n').find(l=>l.startsWith('HLD÷'))).toBe('HLD÷30,DLI/SGNDLI1/100/300,HAN/SGNHAN1/100/300');
    expect(text.split('\n').find(l=>l.startsWith('POD÷'))).toContain(',ALT=CXR,');
  });
  it('reads real JetPlan OFP ALT DATA and produces the same airports in downloadable REQ bytes', () => {
    const fixture=readFileSync(`${__dirname}/fixtures/quick_pack_vj5288.txt`,'utf8');
    const block=fixture.match(/\(FPL-[\s\S]*?\)/)?.[0];
    if(!block) throw new Error('Missing fixture FPL');
    const fields=reqOfpAlternates(fixture,block,'ZSHC');
    expect(fields).toEqual({alt1:'NKG',alt2:'NGB',talt:'DAD',alternate_source:'ofp'});
    const text=build_req(db,[{id:1,...fields}],'OLD DSP',[]);
    const decoded=Array.from(req_bytes(text),b=>String.fromCharCode(b)).join('');
    expect(decoded.split('\r\n').find(l=>l.startsWith('HLD÷'))).toBe('HLD÷30,NKG/SGNNKG1/100/300,NGB/SGNNGB1/100/300');
  });
});