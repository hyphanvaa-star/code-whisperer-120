/** Applied only by the HTML shim; preserve the original operational page. */
export function patchFlightRefreshPage(html: string): string {
  // Limit option retention to flight/DSP catalogues; unrelated editors keep their rules.
  for (const name of ["nmRefreshDspList", "nmRefreshFltList", "acRefreshDspList", "tlRefreshDspList", "tlRefreshDspPibList", "tlRefreshDspBriefList"]) {
    const block = new RegExp(`function ${name}\\(\\)\\{[\\s\\S]*?(?=\\n(?:async )?function |\\n/\\*)`);
    html = html.replace(block, source => source
      .replace('  const keep = sel.value;', '  const keep = sel.value;\n  const previous = [...sel.options].find(o => o.value === keep);')
      .replace(/(  const sel = [^\n]+, keep = sel.value;)/, '$1\n  const previous = [...sel.options].find(o => o.value === keep);')
      .replace('  if(keep && [...sel.options].some(o => o.value === keep)) sel.value = keep;', '  keepFlightSelection(sel, keep, previous);')
      .replace('  sel.value = keep;', '  keepFlightSelection(sel, keep, previous);'));
  }
  return html
    .replace(/async function syncToolFlights\(refresh\)\{[\s\S]*?(?=\n\/\/ Đổi bộ lọc)/, `let toolFlightRevision = 0;
async function syncToolFlights(refresh){
  const revision = ++toolFlightRevision;
  try{
    const p = new URLSearchParams();
    p.set("days", "2");
    p.set("back", String(Math.max(OPS_BACK_H, BOARD_BACK_H)));
    p.set("ahead", String(Math.max(OPS_AHEAD_H, BOARD_AHEAD_H, NM_FLT_AHEAD_H)));
    // Isolate caches can disagree: every catalogue read must be authoritative.
    p.set("refresh", "1");
    const r = await fetch("/api/flights?" + p.toString(), {cache:"no-store"});
    if(!r.ok) return;
    const d = await r.json();
    if(revision !== toolFlightRevision || !d || d.error || !Array.isArray(d.flights)) return;
    allFlights = d.flights;
  }catch(err){
    // Never replace the all-DSP catalogue with the filtered board on failure.
    console.warn("Không làm mới được danh sách chuyến; giữ lần tải thành công.");
  }
}
function keepFlightSelection(sel, value, previous){
  if(!value) return;
  if(![...sel.options].some(o => o.value === value) && previous){
    const held = previous.cloneNode(true);
    held.disabled = true;
    sel.appendChild(held);
  }
  sel.value = value;
}
`)
    // A detected change must not be re-read from a different worker's stale cache.
    .replace('    await loadFlights(false, true);', '    await loadFlights(true, true);')
    .replace('    nmDrawTrack(d);\n    setMode("notam");', '    nmDrawTrack(d);\n    if(mode !== "notam") setMode("notam");')
    .replace(/(<span id="appVersion"[^>]*>)V 2\.60(<\/span>)/, '$1V 2.61$2');
}