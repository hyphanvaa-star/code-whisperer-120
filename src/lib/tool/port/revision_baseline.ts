import type { Change, DiffResult, Leg } from './xlsdiff';

/** File dates come from the sheet, never its upload time or arbitrary filename. */
export function operatingDays(legs: Pick<Leg, 'day'>[]): string[] {
  return [...new Set(legs.flatMap(l => l.day && Number.isFinite(l.day.getTime()) ? [l.day.toISOString().slice(0, 10)] : []))].sort();
}

/** Keep upload order, but require a known common operating day for a Crewlist predecessor. */
export function cmpCrewPair<T extends { name: string; operating_days?: string[] }>(files: T[], current: string): T[] {
  const crews = files.filter(f => !/\bVER\s*\d+|FLIGHT\s*PLAN|\bFPL\b/i.test(f.name) && !/^~\$|^_crewprev_/.test(f.name));
  const index = crews.findIndex(f => f.name === current);
  const latest = crews[index];
  if (!latest || !latest.operating_days?.length) return [];
  const previous = crews.slice(index + 1).find(f => f.name !== latest.name && f.operating_days?.some(d => latest.operating_days?.includes(d)));
  return previous ? [previous, latest] : [];
}

/** Version evidence exists only on dates present in both sheets; all=1 may still read a neutral current snapshot. */
export function revisionBaseline(res: DiffResult, all = false): DiffResult {
  const day = (l: Leg | null) => l?.day && Number.isFinite(l.day.getTime()) ? l.day.toISOString().slice(0, 10) : '';
  const olds = new Set(res.oldFile ? res.changes.flatMap(c => day(c.old) ? [day(c.old)] : []) : []);
  const news = new Set(res.changes.flatMap(c => day(c.new) ? [day(c.new)] : []));
  const common = new Set([...news].filter(d => olds.has(d)));
  const changes: Change[] = [];
  for (const c of res.changes) {
    const od = day(c.old), nd = day(c.new);
    if ((!c.old || od && common.has(od)) && (!c.new || nd && common.has(nd)) && (!c.old || !c.new || od === nd)) changes.push(c);
    else if (all && c.new) changes.push({...c, old: c.new});
  }
  return {...res, changes, warn: common.size ? '' : 'Chưa có bản trước cùng ngày khai thác — không so sánh lịch sử.'};
}