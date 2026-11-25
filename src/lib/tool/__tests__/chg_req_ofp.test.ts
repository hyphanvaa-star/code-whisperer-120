import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../types';

const mocks=vi.hoisted(()=>({pdf:vi.fn(),flights:vi.fn()}));
vi.mock('../store.server',()=>({setJson:vi.fn(),getJson:async(_ctx:unknown,key:string,fallback:unknown)=>key==='fpl.alt_route'
  ? {routes:[{podpoa:'UIHSGN',alt1:'HAN',alt2:'DLI',talt:'CXR'}]}:fallback}));
vi.mock('../handlers/excel.server',()=>({currentExcel:async()=>({file:'test.xlsx',sheet:0}),
  readSheet:async()=>({sheets:[{}]}),pickSheet:()=>({})}));
vi.mock('../port/fpl_tool',async(importOriginal)=>({...(await importOriginal<typeof import('../port/fpl_tool')>()),
  flights_from_crew_sheet:()=>[{row:1,flt:'1342',date:'25/11/2026',dep:'UIH',arr:'SGN',reg:'VN-A580',ac:321,etd:'09:00',cpt_id:'12345',cpt_name:'NEW CAPTAIN',fo_id:'54321',fo_name:'NEW FO'}]}));
vi.mock('../core/gantts.server',()=>({loadFlights:mocks.flights}));
vi.mock('@/lib/flitebrief.server',()=>({fbGet:mocks.pdf}));
import { routes } from '../handlers/fpl.server';

const ofp=(alts='VVCR VVCT',talt='VVDN')=>`EST PLD 13750\nEXTRA 400 0:20\nDISPATCHER OLD DISPATCHER\n(FPL-VJC1342-IS\n-A321/M-SDE2E3FGHIJ1RWY/LB1\n-VVPC0200\n-N0450F330 DCT\n-VVTS0100${alts?' '+alts:''}\n-PBN/A1B2 DOF/261125 REG/VNA629${talt?' TALT/'+talt:''}\n-E/0300)`;
const body={sector_id:1342,flt:'1342',date:'25/11/2026',route:'UIH-SGN',dsp:'WRONG WEB DSP',alt1:'DLI',alt2:'HAN',talt:'CXR'};
const run=async(input=body)=>{
  const handler=routes['POST /api/fpltext/chgreq'];
  if(!handler) throw new Error('Missing REQ handler');
  return await handler({json:async()=>input} as unknown as Ctx) as Record<string,any>;
};
describe('Change REQ handler OFP-only alternates',()=>{
  afterEach(()=>vi.useRealTimers());
  beforeEach(()=>{
    vi.clearAllMocks();vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-25T02:45:00Z'));
    mocks.flights.mockResolvedValue([{id:1342,callsign:'VJC1342',std:new Date('2026-11-25T02:00:00Z'),dep_iata:'UIH',dep_icao:'VVPC',dest_iata:'SGN',dest_icao:'VVTS',reg:'VN-A629'}]);
    mocks.pdf.mockImplementation(async()=>new Response(ofp()));
  });
  it('downloaded REQ keeps OFP airports and DSP but uses new Crewlist aircraft/crew',async()=>{
    const result=await run();
    expect(result['error']).toBeUndefined();
    expect(result).toMatchObject({alt1:'CXR',alt2:'VCA',talt:'DAD',reg:'VN-A580',dsp:'OLD DISPATCHER',alternate_source:'ofp'});
    const downloaded=Array.from(atob(result['file'] as string),ch=>ch).join('');
    expect(downloaded.split('\r\n').find(l=>l.startsWith('HLD÷'))).toBe('HLD÷30,CXR/SGNCXR1/100/300,VCA/SGNVCA1/100/300');
    expect(downloaded.split('\r\n').find(l=>l.startsWith('POD÷'))).toContain(',ALT=DAD,');
    expect(downloaded).toContain('AIR÷$VNA580/');
    expect(downloaded).toContain('CPT/12345 NEW CAPTAIN,FOF/54321 NEW FO,DSP/OLD DISPATCHER');
    expect(downloaded).toContain('PAY÷13750');
  });
  it('does not add optional ALT2 or TALT from KHB/body/route defaults',async()=>{
    mocks.pdf.mockImplementation(async()=>new Response(ofp('VVCR','')));
    const result=await run();
    expect(result).toMatchObject({alt1:'CXR',alt2:'',talt:''});
    expect(result['text'].split('\n').find((l:string)=>l.startsWith('HLD÷'))).toBe('HLD÷30,CXR/SGNCXR1/100/300');
    expect(result['text'].split('\n').find((l:string)=>l.startsWith('POD÷'))).not.toContain(',ALT=');
  });
  it('blocks export when OFP alternate is unresolved instead of using a default',async()=>{
    mocks.pdf.mockImplementation(async()=>new Response(ofp('ZZZZ')));
    const result=await run();
    expect(result['error']).toContain('chưa xác định được mã IATA');
    expect(result['file']).toBeUndefined();
  });
  it('never downloads yesterday’s sector OFP for today’s REQ',async()=>{
    mocks.flights.mockResolvedValue([{id:1342,callsign:'VJC1342',std:new Date('2026-11-24T02:00:00Z'),dep_iata:'UIH',dep_icao:'VVPC',dest_iata:'SGN',dest_icao:'VVTS',reg:'VN-A629'}]);
    expect(await run()).toHaveProperty('error');
    expect(mocks.pdf).not.toHaveBeenCalled();
  });
});