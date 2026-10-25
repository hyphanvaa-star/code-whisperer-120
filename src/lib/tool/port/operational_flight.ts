import { inOpsWindow } from './atc_ezfw';

const MON: Record<string, number> = { JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12 };
export function parseOpsDate(date: unknown): { y?: number; m: number; d: number } | null {
  const s = String(date ?? '').trim().toUpperCase();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y: number | undefined, m: number, d: number;
  if (match) { y = Number(match[1]); m = Number(match[2]); d = Number(match[3]); }
  else {
    match = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(s);
    if (match) { d = Number(match[1]); m = Number(match[2]); y = match[3] ? Number(match[3]) : undefined; }
    else {
      match = /^(\d{1,2})[\s\-]?([A-Z]{3})[\s\-]?(\d{2}|\d{4})?$/.exec(s);
      if (!match) return null;
      d = Number(match[1]); m = MON[match[2] ?? ''] ?? 0; y = match[3] ? Number(match[3]) : undefined;
    }
    if (y !== undefined && y < 100) y += 2000;
  }
  const check = new Date(Date.UTC(y ?? 2000, m - 1, d));
  return check.getUTCMonth() + 1 === m && check.getUTCDate() === d ? { y, m, d } : null;
}

export function sameOpsDay(std: unknown, date: unknown): boolean {
  const day = parseOpsDate(date);
  if (!day || !std) return false;
  const t = std instanceof Date ? std : new Date(String(std));
  if (!Number.isFinite(t.getTime())) return false;
  return [0, 7].some(h => {
    const local = new Date(t.getTime() + h * 3600_000);
    return (day.y === undefined || local.getUTCFullYear() === day.y)
      && local.getUTCMonth() + 1 === day.m && local.getUTCDate() === day.d;
  });
}

export interface OperationalSector {
  id: number; callsign: string; fltno?: string; commercial_fltno?: string;
  std: Date | null; dep_iata: string; dep_icao: string; dest_iata: string; dest_icao: string;
}
const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
const num = (v: unknown) => norm(v).replace(/^VJC?/, '').replace(/^0+(?=\d)/, '');
export function selectOperationalFlight<T extends OperationalSector>(flights: T[], spec: Record<string, unknown>, now = new Date()): T {
  const sectorId = Number(spec.sector_id || 0);
  const day = parseOpsDate(spec.date);
  const dep = norm(spec.dep), arr = norm(spec.arr);
  const flight = num(spec.flt);
  if (!sectorId && (!flight || !day || !dep || !arr)) throw new Error('Thiếu ngày hoặc chặng chuyến — không tự chọn OFP.');
  if (spec.date && !day) throw new Error('Ngày chuyến không hợp lệ — không tự chọn OFP.');
  const hits = flights.filter(f => inOpsWindow(f.std, now)
    && (!sectorId || f.id === sectorId)
    && (!flight || [f.callsign, f.fltno, f.commercial_fltno].some(cs => num(cs) === flight))
    && (!day || sameOpsDay(f.std, spec.date))
    && (!dep || [f.dep_iata, f.dep_icao].map(norm).includes(dep))
    && (!arr || [f.dest_iata, f.dest_icao].map(norm).includes(arr)));
  if (hits.length !== 1) throw new Error(hits.length ? 'Có nhiều sector cùng chuyến/ngày/chặng — cần chọn đúng chuyến.' : 'Không có chuyến đúng ngày/chặng trong khung −6/+24 giờ.');
  const hit = hits[0];
  if (!hit) throw new Error('Không xác định được chuyến.');
  return hit;
}

export function validateOperationalAtc(block: string, sector: OperationalSector): void {
  if (!sector.std || !inOpsWindow(sector.std)) throw new Error('Chuyến đã ngoài khung −6/+24 giờ.');
  const dof = sector.std.toISOString().slice(2, 10).replace(/-/g, '');
  if (/\bDOF\/(\d{6})\b/.exec(block)?.[1] !== dof) throw new Error('OFP có DOF khác ngày chuyến — bỏ qua file cũ.');
  if (num(/\(FPL-([A-Z0-9]+)-/.exec(block)?.[1]) !== num(sector.callsign)
    || !new RegExp('-' + sector.dep_icao + '\\d{4}\\b').test(block)
    || !new RegExp('-' + sector.dest_icao + '\\d{4}\\b').test(block)) throw new Error('OFP không khớp số hiệu/chặng chuyến.');
}