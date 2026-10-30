type NotamPack = { places?: { code?: string; notams?: { ident?: string; level?: string }[]; dropped?: { ident?: string; level?: string }[] }[] };

/** Count the displayed assessment, including filtered rows, once per place/ID. */
export function notamCounts(pack: NotamPack | null) {
  let total = 0, impact = 0, noimpact = 0;
  for (const place of pack?.places || []) {
    const seen = new Set<string>();
    for (const row of [...(place.notams || []), ...(place.dropped || [])]) {
      if (row.ident && seen.has(row.ident)) continue;
      if (row.ident) seen.add(row.ident);
      total++;
      if (row.level === 'CRITICAL' || row.level === 'DELAY-ONLY') impact++;
      if (row.level === 'NO IMPACT') noimpact++;
    }
  }
  return { total, impact, noimpact };
}