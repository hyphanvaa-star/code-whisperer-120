// Storage retention rules for tool-files (pure, testable).
const H = 3600_000;
/** Start of yesterday in Vietnam time (UTC+7), as epoch ms. */
export function vnYesterdayStart(now: number): number {
  const vn = now + 7 * H;
  const dayStart = Math.floor(vn / (24 * H)) * 24 * H;
  return dayStart - 24 * H - 7 * H;
}
/** True when the file at `path` (last updated at `updated`) should be deleted. */
export function shouldDelete(path: string, updated: number, now: number): boolean {
  const top = path.split("/")[0];
  if (top === "excel") return updated < vnYesterdayStart(now); // keep yesterday/today/tomorrow
  if (top === "atc" || top === "merged" || top === "briefing") return now - updated > 2 * H; // exports: after use
  if (top === "regnotice") return now - updated > 24 * H; // MEL: replaced by the next split; 24 h is only a safety net
  if (top === "notices-tmp") return now - updated > 12 * H; // session PDFs
  return false; // pibwx has own cleanup; notices/ is the admin shared library
}
/** A shift ends when the web was closed longer than this: then every operational file is dropped, MEL included. */
export const SESSION_GRACE_MS = 2 * H;
/** Operational folders that only live for the current working session. */
export const SESSION_TOPS = ["excel", "atc", "merged", "briefing", "regnotice", "notices-tmp", "pibwx"];
/** On web open after the web was closed > 2 h: drop operational files from earlier sessions, split MEL included,
 *  so yesterday's MEL can never be attached by mistake. Midnight alone never deletes anything (night shifts). */
export function staleOnOpen(path: string, updated: number, now: number, graceMs = SESSION_GRACE_MS): boolean {
  const top = path.split("/")[0];
  return SESSION_TOPS.includes(top) && now - updated > graceMs;
}
/** Offline means the server saw no open tab of this user for longer than `graceMs` (reloads keep files). */
export function offlineLongEnough(lastAlive: number | null | undefined, now: number, graceMs = SESSION_GRACE_MS): boolean {
  return !lastAlive || !Number.isFinite(lastAlive) || now - lastAlive > graceMs;
}
/** MEL files a new split makes obsolete: every per-aircraft file not in the new set. */
export function staleMelFiles(existing: string[], fresh: string[]): string[] {
  const keep = new Set(fresh.map((n) => n.toUpperCase()));
  return existing.filter((n) => /^VNA\d{3}\.pdf$/i.test(n) && !keep.has(n.toUpperCase()));
}
