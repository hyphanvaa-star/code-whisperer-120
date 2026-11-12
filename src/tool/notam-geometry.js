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
      // Ticked = only areas within the route corridor; unticked (default) shows every boundary.
      nmLayerCtl.addOverlay(allAreasLayer, 'Ẩn vùng xa route (>50 NM)');
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
  // Map-only corridor for the "hide MINOR" box: anything farther than this
  // from the drawn route is hidden, whatever its verdict. Lists stay intact.
  const MAP_CORRIDOR_NM = 50;
  const routeLines = function (packs) {
    const lines = [];
    for (const pack of packs) {
      if (!pack) continue;
      let ll = (pack.track || []).map(p => [Number(p.lat), Number(p.lon)]);
      ll = ll.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (ll.length < 2) {
        ll = (pack.line || []).map(p => [Number(p[1]), Number(p[0])])
          .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      }
      if (ll.length) lines.push(ll);
    }
    return lines;
  };
  // Local flat projection (NM) around the segment: good enough for a 50 NM gate.
  const ptSegNm = function (p, a, b) {
    const k = Math.cos(((a[0] + b[0] + p[0]) / 3) * Math.PI / 180);
    const wrap = d => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);
    const ax = wrap(a[1] - p[1]) * 60 * k, ay = (a[0] - p[0]) * 60;
    const bx = wrap(b[1] - p[1]) * 60 * k, by = (b[0] - p[0]) * 60;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    let t = len ? -(ax * dx + ay * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx, y = ay + t * dy;
    return Math.sqrt(x * x + y * y);
  };
  const ptLineNm = function (p, line) {
    if (line.length === 1) return ptSegNm(p, line[0], line[0]);
    let best = Infinity;
    for (let i = 1; i < line.length; i++) best = Math.min(best, ptSegNm(p, line[i - 1], line[i]));
    return best;
  };
  const inRing = function (p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
      if ((yi > p[0]) !== (yj > p[0]) && p[1] < (xj - xi) * (p[0] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const hitRouteNm = function (hit, lines) {
    const ring = (hit.ring || []).map(p => [Number(p[0]), Number(p[1])])
      .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    const rad = Number(hit.radius_nm) || 0;
    const isArea = ring.length >= 3 && hit.shape !== 'line' && hit.shape !== 'linestring' && !(rad > 0);
    const pts = ring.length ? ring
      : (hit.lat != null && hit.lon != null ? [[Number(hit.lat), Number(hit.lon)]] : []);
    if (!pts.length || !pts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1]))) return null;
    let best = Infinity;
    for (const line of lines) {
      for (const p of pts) best = Math.min(best, ptLineNm(p, line));
      if (pts.length >= 2) {
        const edges = isArea ? pts.concat([pts[0]]) : pts;
        for (const q of line) {
          if (isArea && inRing(q, ring)) return 0;
          best = Math.min(best, ptLineNm(q, edges));
        }
      }
    }
    return Math.max(0, best - (rad > 0 ? rad : 0));
  };
  const nearRoute = function (list, packs) {
    const lines = routeLines(packs);
    if (!lines.length) return list; // no route geometry: never hide without evidence
    return list.filter(h => {
      if (!h) return false;
      if (/^(?:A|AD|APT)$/.test(String(h.kind || '').toUpperCase())) return true; // DEP/DEST/ALTN airports
      const d = hitRouteNm(h, lines);
      return d == null || d <= MAP_CORRIDOR_NM;
    });
  };
  const mapPacks = function () {
    return nmMapIsTrack() ? [nmTrackData]
      : nmFleetSum && nmData && nmData.fleet && nmGroup !== NM_GROUP_TRACK
        ? Object.entries(nmData.tracks || {}).filter(([id]) => nmFleetTicked(id)).map(([, pack]) => pack)
        : [nmTrackData];
  };
  // Real boundaries (polygon/line/circle) from this flight's checked source,
  // including MINOR ones; never centre-only pins or the worldwide catalogue.
  const restoreAreas = function (visible, packs) {
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
    return visible;
  };
  nmPlotHits = function (hits, bounds) {
    // Both shape and dot passes must see the upgraded geometry, not raw hits.
    let visible = (hits || []).slice();
    const hideFar = !!(allAreasLayer && nmMap && nmMap.hasLayer(allAreasLayer));
    const packs = mapPacks();
    if (hideFar) {
      // A single explicitly focused NOTAM is always drawn. Otherwise every
      // area within the corridor stays for the dispatcher to judge, whatever
      // its verdict; only areas farther than the corridor are hidden.
      if (visible.length !== 1) {
        visible = nearRoute(restoreAreas(visible.map(nmRefreshHitGeom).filter(Boolean), packs), packs);
      }
    } else {
      visible = restoreAreas(visible, packs); // never changes verdict data
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