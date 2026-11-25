// Display-only search geometry. Never borrow a country's operational ATS layer.
export interface MapSearchRoutePart {
  pts: [number, number][];
  fixes: string[];
}
export interface MapSearchRouteRow {
  keys: string[];
  show: string;
  kind: string;
  route: string;
  cc: string;
  lat: number;
  lon: number;
  routeParts: MapSearchRoutePart[];
}

// Self-contained for serialization into the original tool document.
export function nmFindRouteRows(routes: unknown): MapSearchRouteRow[] {
  const rows = new Map<string, MapSearchRouteRow>();
  for (const raw of Array.isArray(routes) ? routes : []) {
    if (!raw || typeof raw !== 'object') continue;
    const rte = raw as Record<string, unknown>;
    const name = String(rte['name'] || '').trim().toUpperCase();
    const cc = String(rte['cc'] || 'VN').trim().toUpperCase();
    const pts = rte['pts'];
    if (!name || !Array.isArray(pts) || pts.length < 2) continue;
    // Reject a broken part instead of joining across a missing coordinate.
    if (!pts.every((p: unknown) => Array.isArray(p) && p.length >= 2
      && typeof p[0] === 'number' && Number.isFinite(p[0]) && Math.abs(p[0]) <= 90
      && typeof p[1] === 'number' && Number.isFinite(p[1]))) continue;
    const points: [number, number][] = pts.map((p: number[]) => [Number(p[0]), Number(p[1])]);
    const mid = points[Math.floor(points.length / 2)];
    if (!mid) continue;
    const key = cc + '|' + name;
    let row = rows.get(key);
    if (!row) {
      row = { keys: [name], show: name, kind: 'Route', route: name, cc,
        lat: mid[0], lon: mid[1], routeParts: [] };
      rows.set(key, row);
    }
    const fixes = Array.isArray(rte['fixes']) ? rte['fixes'] : [];
    row.routeParts.push({ pts: points, fixes: points.map((_, i) => typeof fixes[i] === 'string' ? fixes[i] : '') });
  }
  return [...rows.values()];
}

const SEARCH_JS = `let nmFindSearchGroup = null;
function nmFindClear(){
  if(nmFindSearchGroup){
    if(nmMap) nmMap.removeLayer(nmFindSearchGroup);
    nmFindSearchGroup.clearLayers();
    nmFindSearchGroup = null;
  }
  if(nmFindPin){
    if(nmMap) nmMap.removeLayer(nmFindPin);
    nmFindPin = null;
  }
}
function nmFindGo(row){
  if(!nmMap || !row) return;
  nmFindClear();
  if(row.kind === "Route"){
    nmFindSearchGroup = L.layerGroup().addTo(nmMap);
    const bounds = L.latLngBounds([]), seen = new Set();
    for(const part of (row.routeParts || [])){
      const line = L.polyline(part.pts, {
        pane: "nmRoute", color: "var(--vj-yellow)", weight: 4,
        opacity: 1, interactive: false
      }).addTo(nmFindSearchGroup);
      bounds.extend(line.getBounds());
      part.pts.forEach(function(p, i){
        const name = part.fixes[i];
        if(!name) return;
        const key = name + "|" + p.join("|");
        if(seen.has(key)) return;
        seen.add(key);
        L.circleMarker(p, {pane: "nmRoute", radius: 3, weight: 1,
          color: "var(--vj-ink)", fillColor: "var(--vj-yellow)",
          fillOpacity: 1, interactive: false}).addTo(nmFindSearchGroup)
          .bindTooltip(esc(name), {permanent: true, direction: "right",
            className: "nm-vn-fix", offset: [6, 0]}).openTooltip();
      });
    }
    if(bounds.isValid()) nmMap.fitBounds(bounds, {padding: [36, 36], maxZoom: 8});
    else nmMap.flyTo([row.lat, row.lon], 7);
  }else{
    const z = nmMap.getZoom();
    nmMap.flyTo([row.lat, row.lon], z < 9 ? 9 : (z > 12 ? 12 : z));
  }
  nmFindPin = L.circleMarker([row.lat, row.lon], {
    pane: "nmRoute", radius: 7, weight: 2, color: "var(--vj-ink)",
    fillColor: "var(--vj-yellow)", fillOpacity: 1, interactive: false
  }).addTo(nmMap);
  nmFindPin.bindTooltip(esc(row.show), {
    permanent: true, direction: "top", offset: [0, -8], className: "nm-wpt-lab"
  }).openTooltip();
}
`;

export function patchNotamMapSearchPage(html: string): string {
  return html
    .replace('function nmFindIndex(j){', () => nmFindRouteRows.toString() + '\nfunction nmFindIndex(j){')
    .replace(`    if(pts.length && rte.name){
      const p = pts[Math.floor(pts.length / 2)];
      if(p && p.length >= 2) put([rte.name], rte.name, "Route", p[0], p[1], rte.name);
    }
  });
  nmFindRows = rows;`, `  });
  nmFindRows = rows.concat(nmFindRouteRows(j.routes));`)
    .replace(/function nmFindGo\(row\)\{[\s\S]*?\n\}\n(?=let nmHitLayers)/, () => SEARCH_JS)
    .replace('  nmFindIndex(j);', '  nmFindClear();\n  nmFindIndex(j);')
    .replace('esc(row.kind + " · " + nmFindCoord(row.lat, row.lon))',
      'esc(row.kind + (row.kind === "Route" ? " · " + row.cc : "") + " · " + nmFindCoord(row.lat, row.lon))')
    // Clear also when an empty search is submitted or the native search ✕ fires.
    .replaceAll('if(!q){ list.hidden = true; return; }', 'if(!q){ nmFindClear(); list.hidden = true; return; }')
    .replace(`    input.addEventListener("input", function(){
      show(nmFindMatch(input.value.trim().toUpperCase()), input.value.trim().toUpperCase());
    });`, `    const searchChanged = function(){
      nmFindClear();
      const q = input.value.trim().toUpperCase();
      show(q ? nmFindMatch(q) : [], q);
    };
    input.addEventListener("input", searchChanged);
    input.addEventListener("search", searchChanged);`)
    .replace('if(ev.key === "Escape") list.hidden = true;',
      'if(ev.key === "Escape"){ ev.preventDefault(); input.value = ""; nmFindClear(); list.hidden = true; }');
}