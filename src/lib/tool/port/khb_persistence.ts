import { normalizeKhbWorkspace } from './khb_workspace';

/** Applied last: leave the original HTML and all existing Crewlist/PLD patches intact. */
export function patchKhbPersistencePage(html: string): string {
  return html
    .replace(/\/\* Giữ bảng KHB qua reload:[\s\S]*?(?=\$\("#ftPreviewBtn"\)\.onclick)/, KHB_KEEP_SCRIPT + '\n')
    .replace('try{ const k = ftKeepKey(); if(k) localStorage.removeItem(k); }catch(e){}', 'ftKeepClear();')
    .replace('async function ftLoad(){\n  const revision = ftCrewRevision;', 'async function ftLoad(){\n  await ftKeepRestore(0);\n  const revision = ftCrewRevision;');
}

export const KHB_KEEP_SCRIPT = `
const ftKeepNormalize = ${normalizeKhbWorkspace.toString()};
function ftKeepUid(){
  try{
    const p = window.parent;
    const uid = p.__fbUserId ? p.__fbUserId() : "";
    return uid && p.__fbToken && p.__fbToken() ? String(uid) : "";
  }catch(e){ return ""; }
}
function ftKeepKey(){ const uid = ftKeepUid(); return uid ? "khb.keep." + uid : ""; }
let ftKeepReady = false, ftKeepCloudReady = false, ftKeepOwner = "", ftKeepRevision = 0;
let ftKeepDirty = false, ftKeepTouched = false, ftKeepExplicitClear = false, ftKeepConflict = false;
let ftKeepLast = "", ftKeepPending = null, ftKeepReading = null, ftKeepT = 0;
function ftKeepSnapshot(){
  return ftKeepNormalize({rows:ftRows, edit:ftEdit, blank:ftBlank,
    dsp:$("#ftDspBox").value || "", efb:($("#fEfb") || {}).value || "", pld:!!ftPldOn,
    extra:($("#ftExtra") || {}).value || "", seq:($("#ftSeq") || {}).value || ""});
}
function ftKeepStatus(text, conflict){
  let el = document.getElementById("ftKeepStatus");
  if(!el){
    const host = document.getElementById("ftStat"); if(!host) return;
    el = document.createElement("span"); el.id = "ftKeepStatus"; el.className = "status"; el.setAttribute("role","status");
    host.insertAdjacentElement("afterend", el);
  }
  el.textContent = text;
  if(conflict){
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn small"; btn.textContent = "↻ Tải bản mới";
    btn.onclick = function(){
      if(!confirm("Bảng đã được lưu ở tab hoặc máy khác. Bỏ chỉnh sửa chưa đồng bộ ở tab này và tải bản mới?")) return;
      if(ftKeepUid() !== ftKeepOwner) return;
      try{ localStorage.removeItem(ftKeepKey()); }catch(e){}
      location.reload();
    };
    el.appendChild(btn);
  }
}
function ftKeepApply(state){
  ftRows = state.rows;
  for(const key of Object.keys(ftEdit)) delete ftEdit[key];
  for(const key of Object.keys(ftBlank)) delete ftBlank[key];
  Object.assign(ftEdit, state.edit); Object.assign(ftBlank, state.blank);
  $("#ftDspBox").value = state.dsp;
  const efb = $("#fEfb"); if(efb) efb.value = state.efb;
  const extra = $("#ftExtra"); if(extra) extra.value = state.extra;
  const seq = $("#ftSeq"); if(seq) seq.value = state.seq;
  ftPldOn = state.pld;
  const btn = $("#ftPldRound");
  if(btn){ btn.classList.toggle("on", ftPldOn); btn.setAttribute("aria-pressed", String(ftPldOn)); btn.textContent = (ftPldOn ? "✓ " : "") + "Auto Rounding PLD"; }
  ftApplying = true;
  try{ ftRender(); }finally{ ftApplying = false; }
  try{ ftCountLine(); }catch(e){}
}
function ftKeepLocal(){
  const uid = ftKeepUid(); if(!uid || uid !== ftKeepOwner) return null;
  const state = ftKeepSnapshot(); if(!state) return null;
  const digest = JSON.stringify(state);
  if(digest !== ftKeepLast){ ftKeepDirty = true; ftKeepLast = digest; }
  const has = state.rows.some(Boolean) || Object.keys(state.blank).length || state.dsp || state.efb;
  if(!has && !ftKeepExplicitClear && !ftKeepTouched) return null;
  try{ localStorage.setItem("khb.keep." + uid, JSON.stringify({version:2, owner:uid, revision:ftKeepRevision, dirty:ftKeepDirty, state})); }
  catch(e){ ftKeepStatus("Chưa lưu được dự phòng trên máy."); }
  return state;
}
function ftKeepSave(){
  if(!ftKeepReady || ftKeepUid() !== ftKeepOwner) return Promise.resolve();
  const state = ftKeepLocal();
  if(!state || !ftKeepDirty || !ftKeepCloudReady || ftKeepConflict || ftKeepPending) return ftKeepPending || Promise.resolve();
  const uid = ftKeepOwner, digest = JSON.stringify(state), revision = ftKeepRevision;
  ftKeepStatus("Đang lưu KHB…");
  const pending = (async function(){
    try{
      const response = await fetch("/api/fpltext/workspace", {method:"POST", cache:"no-store", keepalive:JSON.stringify(state).length < 50000,
        headers:{"Content-Type":"application/json"}, body:JSON.stringify({state, revision})});
      const result = await response.json();
      if(ftKeepUid() !== uid || ftKeepOwner !== uid) return;
      if(!response.ok || result.error || result.owner !== uid) throw new Error("save");
      if(result.conflict){
        const latest = ftKeepNormalize(result.state);
        if(latest && JSON.stringify(latest) === digest){
          ftKeepRevision = result.revision; ftKeepDirty = JSON.stringify(ftKeepSnapshot()) !== digest;
          ftKeepLast = JSON.stringify(ftKeepSnapshot()); ftKeepLocal(); ftKeepStatus("✓ KHB đã lưu theo tài khoản"); return;
        }
        ftKeepConflict = true; ftKeepStatus("Có bản mới ở tab/máy khác; bản đang sửa vẫn giữ trên máy. ", true); return;
      }
      if(!result.ok || !Number.isSafeInteger(result.revision)) throw new Error("save");
      ftKeepRevision = result.revision;
      ftKeepDirty = JSON.stringify(ftKeepSnapshot()) !== digest;
      ftKeepLast = JSON.stringify(ftKeepSnapshot());
      ftKeepLocal();
      ftKeepStatus(ftKeepDirty ? "Đang chờ lưu chỉnh sửa mới…" : "✓ KHB đã lưu theo tài khoản");
    }catch(e){ if(ftKeepUid() === uid) ftKeepStatus("Chưa đồng bộ KHB; giữ bản trên máy, sẽ thử lại."); }
    finally{ if(ftKeepPending === pending) ftKeepPending = null; }
  })();
  ftKeepPending = pending;
  return pending.then(function(){ if(ftKeepDirty && !ftKeepConflict) clearTimeout(ftKeepT), ftKeepT = setTimeout(ftKeepSave, 1500); });
}
function ftKeepLater(){
  setTimeout(function(){ if(ftKeepReady) ftKeepLocal(); }, 0);
  clearTimeout(ftKeepT); ftKeepT = setTimeout(ftKeepSave, 400);
}
function ftKeepClear(){
  ftKeepTouched = true; ftKeepExplicitClear = true;
  ftKeepDirty = true; ftKeepLater();
}
function ftKeepRestore(){
  if(ftKeepCloudReady) return Promise.resolve();
  if(ftKeepReading) return ftKeepReading;
  const uid = ftKeepUid();
  if(!uid) return new Promise(function(resolve){ setTimeout(function(){ resolve(ftKeepRestore()); }, 250); });
  if(ftKeepOwner && ftKeepOwner !== uid) return Promise.resolve();
  ftKeepOwner = uid;
  let local = null;
  if(!ftKeepReady){
    try{
      const raw = JSON.parse(localStorage.getItem("khb.keep." + uid) || "null");
      if(raw && (!raw.owner || raw.owner === uid)){
        const state = ftKeepNormalize(raw.version === 2 ? raw.state : raw);
        if(state) local = {state, dirty:raw.version !== 2 || raw.dirty === true, revision:raw.version === 2 && Number.isSafeInteger(raw.revision) ? raw.revision : 0};
      }
    }catch(e){}
    if(local && !ftKeepTouched && !ftRows.some(Boolean)){
      ftKeepApply(local.state); ftKeepRevision = local.revision; ftKeepDirty = local.dirty;
      ftKeepStatus("KHB đã khôi phục trên máy; đang kiểm tra bản lưu tài khoản…");
    }
    ftKeepLast = JSON.stringify(ftKeepSnapshot());
  }
  const before = JSON.stringify(ftKeepSnapshot());
  const reading = (async function(){
    try{
      const response = await fetch("/api/fpltext/workspace", {cache:"no-store"});
      const result = await response.json();
      if(ftKeepUid() !== uid || ftKeepOwner !== uid) return;
      if(!response.ok || result.error || !result.ok || result.owner !== uid || !Number.isSafeInteger(result.revision)) throw new Error("read");
      const cloud = result.state == null ? null : ftKeepNormalize(result.state);
      if(result.state != null && !cloud) throw new Error("invalid");
      const changed = ftKeepTouched || ftKeepDirty || before !== JSON.stringify(ftKeepSnapshot());
      if(changed && cloud && JSON.stringify(cloud) === JSON.stringify(ftKeepSnapshot())){
        ftKeepLast = JSON.stringify(ftKeepSnapshot()); ftKeepDirty = false;
        ftKeepStatus("✓ KHB đã khôi phục theo tài khoản");
      }else if(changed && ftKeepRevision !== result.revision && result.revision !== 0){
        ftKeepConflict = true;
        ftKeepStatus("Có bản mới ở tab/máy khác; bản đang sửa vẫn giữ trên máy. ", true);
      }else if(cloud && !changed){
        ftKeepApply(cloud); ftKeepLast = JSON.stringify(ftKeepSnapshot()); ftKeepDirty = false;
        ftKeepStatus("✓ KHB đã khôi phục theo tài khoản");
      }else{
        ftKeepDirty = changed || !!(ftKeepSnapshot().rows.some(Boolean) || Object.keys(ftKeepSnapshot().blank).length);
        ftKeepStatus(ftKeepDirty ? "KHB đang chờ đồng bộ…" : "KHB lưu theo tài khoản");
      }
      if(!ftKeepConflict) ftKeepRevision = result.revision;
      ftKeepCloudReady = true;
    }catch(e){ if(ftKeepUid() === uid) ftKeepStatus("Chưa đọc được bản lưu tài khoản; giữ dữ liệu trên máy, sẽ thử lại."); }
    finally{
      if(ftKeepUid() === uid){ ftKeepReady = true; ftKeepLocal(); }
      if(ftKeepReading === reading) ftKeepReading = null;
    }
  })();
  ftKeepReading = reading;
  return reading.then(function(){ if(ftKeepCloudReady && ftKeepDirty) ftKeepLater(); });
}
(function(){
  const wrap = document.getElementById("wrapFplText");
  function changed(){ ftKeepTouched = true; ftKeepLater(); }
  if(wrap){
    wrap.addEventListener("input", changed);
    wrap.addEventListener("change", changed);
    wrap.addEventListener("click", ftKeepLater);
    wrap.addEventListener("focusout", ftKeepLater);
    wrap.addEventListener("pointerup", ftKeepLater);
  }
  window.addEventListener("pagehide", ftKeepSave);
  window.addEventListener("online", function(){ ftKeepRestore().then(ftKeepSave); });
  setInterval(function(){ ftKeepRestore().then(ftKeepSave); }, 15000);
  setTimeout(function(){ ftKeepRestore(); }, 300);
})();
`;