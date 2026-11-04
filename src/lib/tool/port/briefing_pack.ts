// Pure helpers for comparing FliteBrief Briefing pack NOTAMs with the web's own
// NOTAM fetch, plus "new NOTAM before departure" detection. Browser-safe: these
// functions are injected into the tool page via Function.prototype.toString, so
// they must stay self-contained (no outer references).

export type PackNotams = Record<string, string[]>;

/** Pack rows look like "VVDN: APT 2610310911 A4214/26" / "RCAA: FIR 2610... B1234/26". */
export function bpParsePack(text: string): PackNotams {
  const re = /\b([A-Z]{4}):\s+(?:APT|FIR)\s+\d{10}\s+([A-Z]\d{4}\/\d{2})\b/g;
  const out: Record<string, Set<string>> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || "")))) {
    (out[m[1]] ||= new Set()).add(m[2]);
  }
  const res: PackNotams = {};
  for (const k of Object.keys(out)) res[k] = [...out[k]].sort();
  return res;
}

type WebPlace = { code?: string; notams?: { ident?: string }[]; dropped?: { ident?: string }[]; notams_src?: { ident?: string }[] };

/** Web NOTAM IDs per place code, normalised to "A1234/26". */
export function bpWebIds(places: WebPlace[] | null | undefined): PackNotams {
  const out: Record<string, Set<string>> = {};
  for (const p of places || []) {
    const code = String(p.code || "").toUpperCase();
    if (!code) continue;
    const set = (out[code] ||= new Set());
    for (const n of [...(p.notams || []), ...(p.dropped || []), ...(p.notams_src || [])]) {
      const mm = String(n.ident || "").toUpperCase().match(/[A-Z]\d{4}\/\d{2}/);
      if (mm) set.add(mm[0]);
    }
  }
  const res: PackNotams = {};
  for (const k of Object.keys(out)) res[k] = [...out[k]].sort();
  return res;
}

/** Only places present on both sides; list pack NOTAMs the web lacks. */
export function bpCompare(pack: PackNotams, web: PackNotams) {
  const missing: { loc: string; id: string }[] = [];
  const common: string[] = [];
  let packCount = 0;
  for (const loc of Object.keys(pack).sort()) {
    if (!web[loc]) continue;
    common.push(loc);
    const have = new Set(web[loc]);
    for (const id of pack[loc]) {
      packCount++;
      if (!have.has(id)) missing.push({ loc, id });
    }
  }
  return { common, packCount, missing };
}

/** IDs in `now` that were not in the baseline. Removed/expired NOTAMs never count. */
export function bpNewIds(baseline: string[], now: string[]): string[] {
  const old = new Set(baseline);
  return [...new Set(now)].filter((id) => !old.has(id)).sort();
}

/** Re-scan once when now is within [dep-60min, dep). */
export function bpDueRescan(depMs: number, nowMs: number, done: boolean): boolean {
  if (done || !Number.isFinite(depMs)) return false;
  return nowMs >= depMs - 3600_000 && nowMs < depMs;
}
