// Browser-only result ownership; no changes to NOTAM assessment rules.
// Helpers are self-contained for serialization into the original tool page.
export function nmSectorKey(flight: unknown): string {
  if (!flight || typeof flight !== 'object') return '';
  const f = flight as Record<string, unknown>;
  if (!f['id']) return '';
  return JSON.stringify(['id', 'callsign', 'date', 'dof', 'std', 'etd', 'sta', 'eta',
    'dep', 'dep_icao', 'dest', 'dest_icao', 'reg'].map(key => String(f[key] || '')));
}

export function nmSectorClone<T>(pack: T): T {
  return JSON.parse(JSON.stringify(pack)) as T;
}

const STATE_JS = `
const nmSectorState = {key: "", epoch: 0, pending: false, message: ""};
const nmSectorTuneSeq = new WeakMap();
function nmSectorSelectedKey(){ return nmSectorKey(nmPickedFlight()); }
function nmSectorCurrent(token){
  return token.epoch === nmSectorState.epoch && token.key === nmSectorSelectedKey();
}
function nmSectorSelect(id, force){
  const key = nmSectorSelectedKey();
  if(!force && key === nmSectorState.key) return;
  nmSectorState.key = key; nmSectorState.epoch++;
  nmSectorState.pending = !!id;
  nmSectorState.message = "Chưa có kết quả NOTAM của chuyến này.";
  nmTrackData = null;
  nmPick = ""; nmFocusIdent = ""; nmShowDropped = false;
  window.nmOvGroup = "";
  nmAwyPick = ""; nmAwyPickId = "";
  nmSyncActiveMap._kind = ""; nmSyncActiveMap._id = "";
  nmWipeMapChrome();
  if(id) nmGroup = NM_GROUP_TRACK;
}
function nmSectorWaiting(){
  return nmSectorState.pending && nmGroup === NM_GROUP_TRACK;
}
function nmSectorPaintWaiting(listToo){
  const f = nmPickedFlight() || {};
  const verdict = $("#nmVerdict");
  if(verdict){
    verdict.innerHTML = ""; verdict.hidden = false; verdict.className = "nm-verdict wait";
    nmVerdictHead(verdict, [f.callsign, [f.dep, f.dest].filter(Boolean).join("–")].filter(Boolean).join("  "));
    const counts = verdict.querySelector(".nm-vd-counts"); if(counts) counts.remove();
    const p = document.createElement("p"); p.className = "nm-vd-empty";
    p.textContent = nmSectorState.message; verdict.appendChild(p);
  }
  if(!listToo) return;
  for(const selector of ["#nmTabs", "#nmGroups", "#nmTrackHits", "#nmPlaceHead", "#nmNote", "#nmStat"]){
    const el = $(selector); if(el){ el.innerHTML = ""; el.hidden = true; }
  }
  const box = $("#nmBox"); if(box) box.hidden = false;
  const list = $("#nmList");
  if(list){ list.hidden = false; list.innerHTML = "";
    const p = document.createElement("div"); p.className = "nm-item miss";
    p.textContent = nmSectorState.message; list.appendChild(p);
  }
  nmPaintNotes([], []);
}
function nmSectorSave(id, pack){
  if(!pack || !pack.tuned || String((pack.flight || {}).id || "") !== String(id)) return;
  const key = pack._sectorKey || nmSectorSelectedKey();
  if(!key || key !== nmSectorSelectedKey()) return;
  const snapshot = nmSectorClone(pack); snapshot._sectorKey = key;
  nmTrackCache[String(id)] = snapshot;
  try{ window.bpSaveBase && window.bpSaveBase(id, snapshot); }catch(_e){}
}
function nmTrackShow(id){
  nmSectorSelect(id);
  const cached = nmTrackCache[String(id)];
  if(!cached || !cached.tuned || cached._sectorKey !== nmSectorSelectedKey()
    || String((cached.flight || {}).id || "") !== String(id)) return false;
  const d = nmSectorClone(cached);
  nmSectorState.pending = false;
  nmGroup = NM_GROUP_TRACK; nmPick = ""; nmShowDropped = false;
  nmSyncActiveMap._kind = "track"; nmSyncActiveMap._id = String(id);
  nmDrawTrack(d); if(mode === "notam") setMode("notam"); nmRender();
  return true;
}
`;

export function patchNotamSectorStatePage(html: string): string {
  return html
    .replace(/function nmTrackShow\(id\)\{[\s\S]*?\n\}\n(?=\$\("#nmTrack"\)\.onclick)/, '')
    .replace('function nmFltPick(id){', () => nmSectorKey.toString() + '\n' + nmSectorClone.toString() + STATE_JS + '\nfunction nmFltPick(id){')
    .replace('  nmPaintVerdict();\n  if(typeof nmTrackShow === "function" && !nmBatch) nmTrackShow(id);',
      '  nmSectorSelect(id);\n  if(nmBatch || !nmTrackShow(id)) nmRender();')
    .replace('  nmFltSyncQ(); nmPaintVerdict();', '  nmFltPick((( $("#nmFlt") || {}).value || "").trim());')
    .replace('function nmRender(){', `function nmRender(){
  if(nmSectorState.key && nmSectorState.key !== nmSectorSelectedKey()) nmSectorSelect((($("#nmFlt") || {}).value || "").trim());
  if(nmSectorWaiting()){ nmSectorPaintWaiting(true); nmSyncTuneUndo(); return; }`)
    .replace('function nmPaintVerdict(){', `function nmPaintVerdict(){
  if(nmSectorState.key && nmSectorState.key !== nmSectorSelectedKey()) nmSectorSelect((($("#nmFlt") || {}).value || "").trim());
  if(nmSectorWaiting()){ nmSectorPaintWaiting(false); return; }`)
    .replace('function nmSyncActiveMap(){', 'function nmSyncActiveMap(){\n  if(nmSectorWaiting()) return;')
    .replace('  }else if(id === NM_GROUP_TRACK){\n    nmTrackData = null;', '  }else if(id === NM_GROUP_TRACK){\n    nmSectorState.epoch++; nmSectorState.pending = false; nmSectorState.key = "";\n    nmTrackData = null;')
    .replace('async function nmTrackOne(){\n  const id = (($("#nmFlt") || {}).value || "").trim();', `async function nmTrackOne(){
  const id = (($("#nmFlt") || {}).value || "").trim();
  if(!id || !nmSectorSelectedKey()){ alert("Chọn chuyến hiện tại trước khi check NOTAM."); return; }
  nmSectorSelect(id, true);
  const sectorToken = {key: nmSectorSelectedKey(), epoch: nmSectorState.epoch};
  nmSectorState.message = "Đang check NOTAM của chuyến…"; nmRender();`)
    .replace('    const d = await r.json();\n    if(d.error){ if(nmBatch)', '    const d = await r.json();\n    if(!nmSectorCurrent(sectorToken)) return;\n    if(d.error){ nmSectorState.message = "Check NOTAM chưa thành công."; nmRender(); if(nmBatch)')
    .replace('if(j && j.text){ stuck = j.text; btn.textContent = nmBatchLbl + j.text; btn.title = j.text; }',
      'if(nmSectorCurrent(sectorToken) && j && j.text){ stuck = j.text; btn.textContent = nmBatchLbl + j.text; btn.title = j.text; }')
    .replace('    nmWptOn = false;\n    const dw = $("#nmWpt");', `    if(String(((d || {}).flight || {}).id || "") !== id) throw new Error("Kết quả NOTAM không đúng chuyến đang chọn.");
    d._sectorKey = sectorToken.key;
    nmWptOn = false;
    const dw = $("#nmWpt");`)
    .replace('    { const hl = $("#nmTrackHits");', '    if(!nmSectorCurrent(sectorToken)) return;\n    { const hl = $("#nmTrackHits");')
    .replace(/    if\(nmTrackData\)\{ nmTrackCache\[id\] = nmTrackData; try\{ window\.bpSaveBase && window\.bpSaveBase\(id, nmTrackData\); \}catch\(_e\)\{\} \}/,
      '    if(!nmSectorCurrent(sectorToken)) return;\n    nmSectorSave(id, d);')
    .replace('    const m = err.name === "AbortError" ? nmTimeoutAlert("5 phút", stuck)', '    if(!nmSectorCurrent(sectorToken)) return;\n    nmSectorState.message = "Check NOTAM chưa thành công."; nmRender();\n    const m = err.name === "AbortError" ? nmTimeoutAlert("5 phút", stuck)')
    // Raw source and geometry only; never send the previous flight's derived hits.
    .replace('head_vi: n.head_vi, ofp_hits: n.ofp_hits,', 'head_vi: n.head_vi, ofp_hits: [],')
    .replace('sid_star: n.sid_star, sid_star_hits: n.sid_star_hits,', 'sid_star: n.sid_star, sid_star_hits: [],')
    .replace('sid_star_hit_names: n.sid_star_hit_names', 'sid_star_hit_names: []')
    // Detach shared source rows before presentation metadata is stamped.
    .replace('  const heads = (extra && extra.heads) || {};', '  pack.places = nmSectorClone(pack.places);\n  const heads = (extra && extra.heads) || {};')
    .replace('  const pack = mode === "domestic" ? nmData : nmTrackData;', `  const pack = mode === "domestic" ? nmData : nmTrackData;
  const tuneToken = {key: nmSectorSelectedKey(), epoch: nmSectorState.epoch};
  if(mode === "track" && (!pack || String((pack.flight || {}).id || "") !== String((($("#nmFlt") || {}).value || "").trim())
    || (pack._sectorKey && pack._sectorKey !== tuneToken.key))){
    alert("Check NOTAM tracking đúng chuyến đang chọn trước khi lọc."); return;
  }
  const tuneSeq = pack ? (nmSectorTuneSeq.get(pack) || 0) + 1 : 0;
  if(pack) nmSectorTuneSeq.set(pack, tuneSeq);`)
    .replace('    if(d.error){ alert("Lọc NOTAM lỗi:\\n\\n" + d.error); return; }', `    if(nmSectorTuneSeq.get(pack) !== tuneSeq || (mode === "track" && (!nmSectorCurrent(tuneToken) || nmTrackData !== pack))) return;
    if(d.error){ if(mode === "track"){ nmSectorState.message = "Phân loại NOTAM chưa thành công."; nmRender(); } alert("Lọc NOTAM lỗi:\\n\\n" + d.error); return; }`)
    .replace('    nmApplyTune(pack, d.dropped || {}, d);', `    nmApplyTune(pack, d.dropped || {}, d);
    if(mode === "track"){
      pack._sectorKey = tuneToken.key; nmSectorState.pending = false;
      nmSectorSave((pack.flight || {}).id, pack);
    }`)
    .replace('    alert("Lọc NOTAM lỗi: " + err.message);', `    if(nmSectorTuneSeq.get(pack) !== tuneSeq || (mode === "track" && !nmSectorCurrent(tuneToken))) return;
    if(mode === "track"){ nmSectorState.message = "Phân loại NOTAM chưa thành công."; nmRender(); }
    alert("Lọc NOTAM lỗi: " + err.message);`)
    .replace('    btn.disabled = false; btn.textContent = idleLabel;',
      '    if(nmSectorTuneSeq.get(pack) === tuneSeq){ btn.disabled = false; btn.textContent = idleLabel; }');
}