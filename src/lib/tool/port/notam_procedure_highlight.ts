// Presentation only: use the same confirmed procedure hits as the summary.
// Keep these helpers self-contained because the tool shim serializes them.
export function nmSidHitNames(n: unknown): string[] {
  if (!n || typeof n !== 'object') return [];
  const row = n as Record<string, unknown>;
  const hits = row['sid_star_hits'];
  const raw: unknown[] = Array.isArray(hits)
    ? hits.flatMap((hit: unknown) => {
        if (!hit || typeof hit !== 'object') return [];
        const procs = (hit as Record<string, unknown>)['procs'];
        return Array.isArray(procs) ? procs : [];
      })
    : Array.isArray(row['sid_star_hit_names']) ? row['sid_star_hit_names'] : [];
  return [...new Set(raw.filter((name): name is string => typeof name === 'string')
    .map(name => name.toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .filter(name => name.length >= 3))];
}

export function nmSidHitRes(n: unknown): string[] {
  const patterns = new Set<string>();
  for (const key of nmSidHitNames(n)) {
    const m = key.match(/^([A-Z]{2,5})(\d{1,2}[A-Z])$/);
    if (m) patterns.add('\\b' + m[1] + '\\s+' + m[2] + '\\b');
    patterns.add('\\b' + key + '\\b');
  }
  return [...patterns];
}

export function patchNotamProcedureHighlightPage(html: string): string {
  return html.replace(/function nmSidHitRes\(n\)\{[\s\S]*?\n\}\n(?=function nmSidStarRows\()/,
    () => nmSidHitNames.toString() + '\n' + nmSidHitRes.toString() + '\n')
    // A new tune map is authoritative, including an empty result; do not keep
    // procedure hits from the previous flight when the new result has none.
    .replace('      if(sidHitMap[key]) patch.sid_star_hits = sidHitMap[key];',
      '      if(extra && extra.sid_star_hits){ patch.sid_star_hits = Array.isArray(sidHitMap[key]) ? sidHitMap[key] : []; patch.sid_star_hit_names = nmSidHitNames(patch); row.sid_star_hits = patch.sid_star_hits; row.sid_star_hit_names = patch.sid_star_hit_names; }');
  // The airport/FIR view reads notams_src while the overview reads kept/dropped;
  // refresh only procedure metadata on both, leaving source text/grades intact.
}