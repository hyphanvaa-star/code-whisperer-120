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
  if (top === "regnotice" || top === "notices-tmp") return now - updated > 12 * H; // session PDFs
  return false; // pibwx has own cleanup; notices/ is the admin shared library
}
