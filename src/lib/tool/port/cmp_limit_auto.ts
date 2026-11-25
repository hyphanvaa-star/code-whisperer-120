/** Reuse the Compare OFP queue; keep completed LIMIT results separate from weights. */
export function patchCmpLimitAutoPage(html: string): string {
  const start = html.indexOf('async function fillWeights(rows, force){');
  const end = html.indexOf('function routeCmpCell(r){', start);
  if (start < 0 || end < 0) throw new Error('Compare OFP queue anchor missing');
  const helpers = `
const cmpLimitResults = new Map();
let cmpLimitGeneration = 0;
function cmpLimitFlight(id){
  return cmpFlightPool().find(f => String(f.id) === String(id));
}
function cmpLimitKey(f){
  if(!f) return "";
  return JSON.stringify([String(f.id), f.callsign, ofpStamp(f), f.dep, f.dest,
    f.gantt_lwt, f.ofp_status, f.has_ofp, limData, ofpRulesCache, cmpLimitGeneration]);
}
function cmpLimitCopies(id, key){
  return [...new Set([...(flights || []), ...(allFlights || [])])]
    .filter(f => String(f.id) === String(id) && inOpsWindow(f) && cmpLimitKey(f) === key);
}
function cmpLimitApply(id, key, warns){
  const copies = cmpLimitCopies(id, key);
  for(const f of copies){
    f.limit_warns = JSON.parse(JSON.stringify(warns));
    f.ofp_check_failed = false;
  }
  return copies.length > 0;
}
function cmpLimitRestore(id){
  const f = cmpLimitFlight(id), saved = cmpLimitResults.get(String(id));
  const w = W_CACHE[id];
  if(!f || !saved || saved.key !== cmpLimitKey(f) || !w || saved.weight !== w || !ofpFitsFlight(f, w)) return false;
  cmpLimitApply(id, saved.key, saved.warns);
  return true;
}
function cmpLimitPending(id){
  const f = cmpLimitFlight(id);
  return !!f && needsOfpCheck(f) && !cmpLimitRestore(id);
}
function cmpLimitStatus(id, key, message, failed){
  for(const f of cmpLimitCopies(id, key)){
    f.ofp_check_failed = !!failed;
    f.limit_warns = (f.limit_warns || []).map(w => {
      if(!w || w.check !== "ofp" || !/Chưa check OFP|Đang tự động đối chiếu OFP|Tự động đối chiếu OFP/.test(w.evidence || "")) return w;
      return Object.assign({}, w, {evidence:message});
    });
  }
}
function cmpLimitBegin(ids){
  const keys = new Map();
  for(const id of ids){
    const f = cmpLimitFlight(id), key = cmpLimitKey(f);
    if(!key) continue;
    keys.set(String(id), key);
    if(needsOfpCheck(f)) cmpLimitStatus(id, key, "Đang tự động đối chiếu OFP…", false);
  }
  if(keys.size) repaintLimitCells(ids);
  return keys;
}
function cmpLimitReceive(d, ids, keys){
  const painted = [];
  const unavailable = new Set((d.no_ofp || []).map(String));
  for(const id of ids){
    const f = cmpLimitFlight(id), key = keys.get(String(id));
    if(!f || !key || key !== cmpLimitKey(f)) continue;
    const w = (d.weights || {})[String(id)];
    const warns = (d.limit_warns || {})[String(id)];
    if(w && ofpFitsFlight(f, w) && Array.isArray(warns)){
      const saved = JSON.parse(JSON.stringify(warns));
      cmpLimitResults.set(String(id), {key:key, warns:saved, weight:W_CACHE[id]});
      cmpLimitApply(id, key, saved);
    }else if(needsOfpCheck(f)){
      const mismatch = w && !ofpFitsFlight(f, w);
      const message = unavailable.has(String(id))
        ? "Tự động đối chiếu OFP: chuyến chưa có OFP để đọc — chờ OFP mới."
        : mismatch ? "Tự động đối chiếu OFP: bản OFP chưa khớp chuyến/CFP hiện tại — chưa thể kết luận."
        : "Tự động đối chiếu OFP: chưa tải/đọc được OFP — sẽ thử lại khi làm mới bảng.";
      cmpLimitStatus(id, key, message, !unavailable.has(String(id)));
    }
    painted.push(id);
  }
  if(painted.length) repaintLimitCells(painted);
}
function cmpLimitFailed(ids, keys){
  cmpLimitReceive({weights:{}, limit_warns:{}}, ids, keys);
}
`;
  let queue = html.slice(start, end)
    .replace('  const ids = rows.map(r => r.sector_id);', '  const ids = [...new Set(rows.map(r => r.sector_id))].filter(id => cmpLimitFlight(id));')
    .replace('    for(const id of ids) delete W_CACHE[id];', '    for(const id of ids){ delete W_CACHE[id]; cmpLimitResults.delete(String(id)); }')
    .replace('  const todo = ids.filter(id => !(id in W_CACHE));', '  for(const id of ids) cmpLimitRestore(id);\n  repaintLimitCells(ids);\n  const todo = ids.filter(id => !(id in W_CACHE) || cmpLimitPending(id));')
    .replaceAll('    const chunk = todo.slice(i, i + W_BATCH);', '    const chunk = todo.slice(i, i + W_BATCH);\n    const limitKeys = cmpLimitBegin(chunk);')
    .replaceAll('        const chunk = missing.slice(i, i + W_BATCH);', '        const chunk = missing.slice(i, i + W_BATCH);\n        const limitKeys = cmpLimitBegin(chunk);')
    // Stop before any cache writes when a newer table has superseded this request.
    .replaceAll('const d = await r.json();', 'const d = await r.json();\n      if(seq !== wSeq) return;')
    .replace('      if(d.error){', '      if(d.error){\n        cmpLimitFailed(chunk, limitKeys);')
    .replace('          if(d.error){ console.warn(d.error); continue; }', '          if(d.error){ cmpLimitFailed(chunk, limitKeys); console.warn(d.error); continue; }')
    .replaceAll('        const w = d.weights[String(id)] || null;', '        if(limitKeys.get(String(id)) !== cmpLimitKey(cmpLimitFlight(id))) continue;\n        const w = (d.weights || {})[String(id)] || null;')
    .replaceAll('applyOfpLimitWarns(d.limit_warns, chunk);', 'cmpLimitReceive(d, chunk, limitKeys);')
    .replace('    const missing = ids.filter(id => !(id in W_CACHE));', '    const missing = ids.filter(id => !(id in W_CACHE) || cmpLimitPending(id));')
    .replaceAll('}catch(err){', '}catch(err){\n      if(seq !== wSeq) return;\n      cmpLimitFailed(chunk, limitKeys);');
  return (html.slice(0, start) + helpers + queue + html.slice(end))
    .replace('function invalidateLimitChecks(){', 'function invalidateLimitChecks(){\n  cmpLimitGeneration++;\n  cmpLimitResults.clear();')
    // Other existing OFP readers must also paint handover and string-ID sectors.
    .replace('const f = flights.find(x => x.id === id);\n    if(!f) continue;\n    f.limit_warns = warns;', 'const f = cmpLimitFlight(id);\n    if(!f) continue;\n    for(const copy of cmpLimitCopies(id, cmpLimitKey(f))) copy.limit_warns = JSON.parse(JSON.stringify(warns));')
    .replace('  warns = limitDisplayWarns(warns, f);', '  warns = limitDisplayWarns(warns, f).map(w => w && w.check === "ofp" && /Chưa check OFP/.test(w.evidence || "") ? Object.assign({}, w, {evidence:"Đang tự động đối chiếu OFP…"}) : w);');
}