// Injected map fixes: never flatten resolved AIP/SUP/arc boundaries back to text.
(function () {
  const originalRefresh = nmRefreshHitGeom;
  nmRefreshHitGeom = function (hit) {
    if (!hit) return hit;
    const source = String(hit.source || '');
    if (source === 'aip' || source === 'aup' || source === 'brg' || source === 'polar'
      || source === 'e-field' || /^(?:AIP SUP|DAH)/i.test(source)) return hit;
    if ((hit.shape === 'polygon' && (hit.ring || []).length >= 3)
      || (hit.shape === 'line' && (hit.ring || []).length >= 2)) return hit;
    // A stale fallback can be upgraded only from explicit boundary coordinates.
    if (hit.shape === 'dot') {
      const blob = [hit.e_field, hit.text].filter(Boolean).join('\n');
      if (/\bARC\b/i.test(blob)) return hit;
      if (!/BOUNDED|JOINING|STRAIGHT\s+LINES|FLW\s+COORD|WI\s+RAD/i.test(blob)) return hit;
      const live = nmNotamToHit({ ident: hit.ident, qsubj: hit.qsubj, text: blob }, { code: hit.icao, kind: hit.kind });
      if (!live) return hit;
      return Object.assign({}, hit, live, { impact: hit.impact === 'dot' ? 'hot' : hit.impact });
    }
    return originalRefresh(hit);
  };
  const originalFind = nmFindHit;
  nmFindHit = function (ident) {
    const want = String(ident || '').toUpperCase();
    const resolved = (nmTrackData ? nmHitsOf(nmTrackData) : []).concat(nmFleetHits());
    const hit = resolved.find(h => String(h.ident || '').toUpperCase() === want && h.shape !== 'dot');
    return hit ? nmRefreshHitGeom(hit) : originalFind(ident);
  };
  const originalRadius = nmParseRadiusNm;
  nmParseRadiusNm = function (text) {
    if (/\bARC\b/i.test(String(text || ''))) return 0;
    return originalRadius(text);
  };
})();