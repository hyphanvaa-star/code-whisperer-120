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

// Body-only fallback: the exact positive ATS-route assessment may already know
// a flown route even if legacy display metadata is missing. Never scan all
// listed routes or global track data, and never feed this into the verdict.
export function nmRouteBodyHits(n: unknown): string[] {
  if (!n || typeof n !== 'object') return [];
  const row = n as Record<string, unknown>;
  if (Array.isArray(row['ofp_body_hits'])) return row['ofp_body_hits'].filter((v): v is string => typeof v === 'string');
  const hits = new Set<string>(Array.isArray(row['ofp_hits'])
    ? row['ofp_hits'].filter((v): v is string => typeof v === 'string') : []);
  const body = String(row['e_field'] || row['text'] || '').toUpperCase();
  for (const reason of Array.isArray(row['reasons']) ? row['reasons'] : []) {
    if (typeof reason !== 'string') continue;
    const match = /Chuyến bay trên ATS route\s+([A-Z0-9,\/\s]+?)\s+nêu trong NOTAM/i.exec(reason);
    if (!match?.[1]) continue;
    for (const key of match[1].toUpperCase().split(/[\s,\/]+/)) {
      if (/^[A-Z]{1,2}\d{1,4}$/.test(key) && new RegExp('\\b' + key + '\\b').test(body)) hits.add(key);
    }
  }
  return [...hits];
}

export function patchNotamProcedureHighlightPage(html: string): string {
  return html.replace(/function nmSidHitRes\(n\)\{[\s\S]*?\n\}\n(?=function nmSidStarRows\()/,
    () => nmSidHitNames.toString() + '\n' + nmSidHitRes.toString() + '\n' + nmRouteBodyHits.toString() + '\n')
    // A new tune map is authoritative, including an empty result; do not keep
    // procedure hits from the previous flight when the new result has none.
    .replace('      if(sidHitMap[key]) patch.sid_star_hits = sidHitMap[key];',
      '      if(extra && extra.sid_star_hits){ patch.sid_star_hits = Array.isArray(sidHitMap[key]) ? sidHitMap[key] : []; patch.sid_star_hit_names = nmSidHitNames(patch); row.sid_star_hits = patch.sid_star_hits; row.sid_star_hit_names = patch.sid_star_hit_names; }')
    .replace('      if(ofpMap[key]) patch.ofp_hits = ofpMap[key];',
      '      if(extra && extra.ofp_hits){ patch.ofp_hits = Array.isArray(ofpMap[key]) ? ofpMap[key] : []; row.ofp_hits = patch.ofp_hits; }')
    .replace('      if(!as && critIds.has(ident)){',
      '      if(extra && (extra.ofp_hits || extra.assess)){ patch.ofp_body_hits = nmRouteBodyHits({ofp_hits: patch.ofp_hits || row.ofp_hits, text: row.text, e_field: row.e_field, reasons: as ? as.reasons : []}); row.ofp_body_hits = patch.ofp_body_hits; }\n      if(!as && critIds.has(ident)){')
    .replace('  const ofpHits = nmOfpHitsOf(n || {});',
      '  const ofpHits = nmIsTwy(n) ? [] : nmRouteBodyHits(n || {});');
  // The airport/FIR view reads notams_src while the overview reads kept/dropped;
  // refresh keyword metadata on both, leaving source text/grades intact.
}