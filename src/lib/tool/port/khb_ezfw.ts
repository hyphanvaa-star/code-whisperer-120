import { extractAtc, extractEzfw, fileCallsign, inOpsWindow } from './atc_ezfw';

export interface EzfwSector {
  id: number;
  callsign: string;
  fltno?: string;
  commercial_fltno?: string;
  std: Date | null;
  reg: string;
  dep_iata: string;
  dep_icao: string;
  dest_iata: string;
  dest_icao: string;
}
export interface EzfwCrew {
  flt: string;
  reg: string;
  dep: string;
  arr: string;
  day: { y?: number | undefined; m: number; d: number } | null;
}
const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '');

export function pickEzfwSector(sectors: EzfwSector[], crew: EzfwCrew, now: Date): EzfwSector {
  if (!crew.day || !crew.reg || !crew.dep || !crew.arr) throw new Error('KHB thiếu ngày, tàu hoặc chặng — không lấy OFP.');
  const day = crew.day;
  const hits = sectors.filter(f => {
    if (![f.callsign, f.fltno || '', f.commercial_fltno || ''].some(cs => digits(cs) === digits(crew.flt))) return false;
    if (!f.std || !inOpsWindow(f.std, now)) return false;
    const dateOk = [0, 7].some(h => {
      const d = new Date(f.std ? f.std.getTime() + h * 3600_000 : NaN);
      return (day.y === undefined || d.getUTCFullYear() === day.y) && d.getUTCMonth() + 1 === day.m && d.getUTCDate() === day.d;
    });
    return dateOk && norm(f.reg) === norm(crew.reg)
      && [f.dep_iata, f.dep_icao].map(norm).includes(norm(crew.dep))
      && [f.dest_iata, f.dest_icao].map(norm).includes(norm(crew.arr));
  }).sort((a, b) => (a.std?.getTime() ?? Infinity) - (b.std?.getTime() ?? Infinity));
  const first = hits[0];
  if (!first) throw new Error('Chưa có OFP đúng ngày/chặng/tàu KHB trong khung −6/+24 giờ.');
  if (hits[1]?.std?.getTime() === first.std?.getTime()) throw new Error('Có sector trùng giờ — chưa xác định duy nhất chuyến.');
  return first;
}

/** Validate the actual PDF, not merely the portal's sector label. */
export function cutVerifiedEzfw(text: string, sector: EzfwSector): { name: string; text: string }[] {
  if (!sector.std) throw new Error('Chuyến thiếu STD.');
  const atc = extractAtc(text);
  const ezfw = extractEzfw(text);
  const cs = fileCallsign(sector.callsign);
  const actualCs = /\(FPL-([A-Z0-9]+)-/.exec(atc)?.[1];
  if (actualCs !== cs) throw new Error('Số hiệu trong OFP không khớp chuyến.');
  const utcDate = sector.std.toISOString().slice(2, 10).replace(/-/g, '');
  if (/\bDOF\/(\d{6})\b/.exec(atc)?.[1] !== utcDate) throw new Error('DOF trong OFP không đúng ngày UTC của chuyến.');
  const atcReg = /\bREG\/([A-Z0-9-]+)/.exec(atc)?.[1] || '';
  const plan = /^PLAN\s+\d+\s+([A-Z0-9]+)\b[^\n]*\b([A-Z]{4})\s+TO\s+([A-Z]{4})[^\n]*\b(\d{2})\/(\d{2})\/(\d{2,4})\s*$/m.exec(ezfw);
  if (!plan || plan[1] !== cs || plan[2] !== sector.dep_icao || plan[3] !== sector.dest_icao) throw new Error('Khối PLAN không khớp số hiệu/chặng OFP.');
  const planDate = (plan[6].length === 4 ? plan[6].slice(2) : plan[6]) + plan[5] + plan[4];
  if (planDate !== utcDate) throw new Error('Ngày trong khối PLAN không khớp chuyến.');
  const planReg = /\b(VN-?A\d{3})\b/.exec(ezfw)?.[1] || '';
  if (norm(atcReg) !== norm(sector.reg) || norm(planReg) !== norm(sector.reg)) throw new Error('Tàu trong OFP không khớp tàu KHB/FliteBrief.');
  if (!new RegExp('-' + sector.dep_icao + '\\d{4}\\b').test(atc) || !new RegExp('-' + sector.dest_icao + '\\d{4}\\b').test(atc)) throw new Error('Chặng trong điện ATC không khớp chuyến.');
  return [{ name: `ATC_${cs}.txt`, text: atc }, { name: `EZFW_${cs}.txt`, text: ezfw }];
}