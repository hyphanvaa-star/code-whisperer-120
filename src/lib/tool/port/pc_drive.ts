/**
 * Company-PC destination folders when the helper reports no D: drive.
 * D:\x → C:\x, but never the bare C:\ root: Windows lets a normal user create
 * folders there, not files, so root saves fail with "Permission denied".
 */
const ROOT_FOLDER: Record<string, string> = { briefing: "Briefing" };

export function pcDest(path: string, hasD: boolean | undefined, kind = ""): string {
  let out = path;
  if (/^d:/i.test(out) && hasD === false) out = "C:" + out.slice(2);
  if (/^c:[\\/]*$/i.test(out)) out = `C:\\${ROOT_FOLDER[kind] ?? "OMC"}`;
  return out;
}

/** A helper timeout means the job is still queued; anything else is a real write failure. */
export function isPcWaitTimeout(err: unknown): boolean {
  return /hết thời gian chờ/i.test(err instanceof Error ? err.message : String(err ?? ""));
}
