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
  let focusIcao = '';
  const originalPlot = nmPlotHits;
  let allAreasLayer = null;
  const originalEnsureMap = nmEnsureMap;
  nmEnsureMap = function () {
    const map = originalEnsureMap.apply(this, arguments);
    if (map && nmLayerCtl && !allAreasLayer) {
      allAreasLayer = L.layerGroup();
      nmLayerCtl.addOverlay(allAreasLayer, 'Bật vùng ảnh hưởng toàn bộ');
      const redraw = function (event) {
        if (event.layer !== allAreasLayer) return;
        if (nmMapIsTrack() && nmTrackData) nmDrawTrack(nmTrackData, true);
        else if (nmFleetSum && nmData && nmData.fleet && nmGroup !== NM_GROUP_TRACK) {
          nmDrawFleetRoutes._sig = '';
          nmDrawFleetRoutes();
        } else if (nmTrackData) nmDrawTrack(nmTrackData, true);
      };
      map.on('overlayadd overlayremove', redraw);
    }
    return map;
  };
  nmPlotHits = function (hits, bounds) {
    // Both shape and dot passes must see the upgraded geometry, not raw hits.
    let visible = (hits || []).slice();
    if (allAreasLayer && nmMap && nmMap.hasLayer(allAreasLayer)) {
      const packs = nmMapIsTrack() ? [nmTrackData]
        : nmFleetSum && nmData && nmData.fleet && nmGroup !== NM_GROUP_TRACK
          ? Object.entries(nmData.tracks || {}).filter(([id]) => nmFleetTicked(id)).map(([, pack]) => pack)
          : [nmTrackData];
      // Restore only actual boundaries from this flight's checked source, not
      // the worldwide catalogue or centre-only pins. Never change verdict data.
      const keys = new Set(visible.map(h => [h.icao, h.ident, nmGeomKey(h)].join('|')));
      for (const pack of packs) for (const raw of (pack && pack.hits) || []) {
        const hit = nmRefreshHitGeom(raw);
        if (!hit || !((hit.ring || []).length >= 3
          || ((hit.shape === 'line' || hit.shape === 'linestring') && (hit.ring || []).length >= 2)
          || Number(hit.radius_nm) > 0)) continue;
        const key = [hit.icao, hit.ident, nmGeomKey(hit)].join('|');
        if (keys.has(key)) continue;
        keys.add(key);
        visible.push(hit);
      }
    }
    return originalPlot(visible.map(nmRefreshHitGeom).filter(Boolean), bounds);
  };
  nmFindHit = function (ident) {
    const want = String(ident || '').toUpperCase();
    const resolved = (nmTrackData ? nmTrackData.hits || [] : []).concat(nmFleetHits());
    const hit = resolved.find(h => String(h.ident || '').toUpperCase() === want
      && (!focusIcao || String(h.icao || '').toUpperCase() === focusIcao) && h.shape !== 'dot');
    return hit ? nmRefreshHitGeom(hit) : originalFind(ident);
  };
  const originalShow = nmShowNotam;
  nmShowNotam = function (icao, ident, flightId) {
    focusIcao = String(icao || '').toUpperCase();
    const owns = pack => ((pack && pack.places) || []).some(p =>
      (!icao || p.code === icao) && (p.notams || []).concat(p.dropped || []).some(n => n.ident === ident));
    let pack = nmGroup === NM_GROUP_TRACK ? nmTrackData : nmData;
    if (!owns(pack)) {
      if (owns(nmTrackData)) { nmGroup = NM_GROUP_TRACK; pack = nmTrackData; }
      else if (owns(nmData)) { nmGroup = NM_GROUP_ALL; pack = nmData; }
    }
    const place = ((pack && pack.places) || []).find(p =>
      (!icao || p.code === icao) && (p.notams || []).concat(p.dropped || []).some(n => n.ident === ident));
    const row = place && (place.notams || []).concat(place.dropped || []).find(n => n.ident === ident);
    if (row) {
      window.nmGrpPlace = place.kind + ':' + place.code;
      window.nmGrpSel = row.level === 'CRITICAL' || row.level === 'DELAY-ONLY' ? 'impact'
        : row.level === 'NEED MANUAL CHECK' ? 'manual'
          : row.level === 'NO IMPACT' || row.skip_why ? 'noimpact' : 'brief';
    }
    return originalShow(icao, ident, flightId);
  };
  const originalRadius = nmParseRadiusNm;
  nmParseRadiusNm = function (text) {
    if (/\bARC\b/i.test(String(text || ''))) return 0;
    return originalRadius(text);
  };
})();