import { describe, expect, it } from 'vitest';
import atc from './fixtures/ATC_VJC7527.txt?raw';
import ezfw from './fixtures/EZFW_VJC7527.txt?raw';
import { cutVerifiedEzfw, pickEzfwSector, type EzfwSector } from '../khb_ezfw';

const sector: EzfwSector = { id: 7527, callsign: 'VJC7527', std: new Date('2026-10-20T18:10:00Z'), reg: 'VN-A629', dep_icao: 'ZGGG', dep_iata: 'CAN', dest_icao: 'VVNB', dest_iata: 'HAN' };
const now = new Date('2026-10-20T14:48:00Z');
const crew = { flt: '7527', reg: 'VN-A629', dep: 'CAN', arr: 'HAN', day: { y: 2026, m: 10, d: 20 } };

describe('KHB ATC/EZFW', () => {
  it('cuts both supplied samples with the exact file names', () => {
    const files = cutVerifiedEzfw('HEADER\n' + atc + '\n' + ezfw + '\nPage - 3\nNEXT PAGE', sector);
    expect(files[0]).toEqual({ name: 'ATC_VJC7527.txt', text: atc.trim() + '\n' });
    expect(files[1]).toEqual({ name: 'EZFW_VJC7527.txt', text: ezfw.replace(/\r\n/g, '\n').trim() + '\n' });
  });
  it('rejects the previous flight number inside an OFP', () => {
    expect(() => cutVerifiedEzfw((atc + ezfw).replace(/VJC7527/g, 'VJC3901'), sector)).toThrow('Số hiệu');
  });
  it('rejects an old DOF even if the portal sector is correct', () => {
    expect(() => cutVerifiedEzfw(atc.replace('DOF/261020', 'DOF/261012') + ezfw, sector)).toThrow('DOF');
  });
  it('rejects the wrong aircraft inside PLAN', () => {
    expect(() => cutVerifiedEzfw(atc + ezfw.replace('VNA629', 'VNA663'), sector)).toThrow('Tàu');
  });
  it('rejects the wrong date inside PLAN', () => {
    expect(() => cutVerifiedEzfw(atc + ezfw.replace('20/10/26', '12/10/26'), sector)).toThrow('Ngày');
  });
  it('rejects the wrong route inside PLAN', () => {
    expect(() => cutVerifiedEzfw(atc + ezfw.replace('ZGGG TO VVNB', 'ZGGG TO VVTS'), sector)).toThrow('chặng');
  });
  it('selects the earliest matching date, route and aircraft within minus 6 plus 24 hours', () => {
    expect(pickEzfwSector([{ ...sector, id: 2, std: new Date('2026-10-20T19:10:00Z') }, sector], crew, now).id).toBe(7527);
  });
  it('never falls back to the wrong aircraft', () => {
    expect(() => pickEzfwSector([{ ...sector, reg: 'VN-A663' }], crew, now)).toThrow('đúng ngày/chặng/tàu');
  });
  it('rejects sectors outside minus 6 plus 24 hours', () => {
    expect(() => pickEzfwSector([sector], crew, new Date('2026-10-21T00:10:01Z'))).toThrow();
  });
  it('rejects equal earliest schedules rather than picking randomly', () => {
    expect(() => pickEzfwSector([sector, { ...sector, id: 9 }], crew, now)).toThrow('trùng giờ');
  });
});