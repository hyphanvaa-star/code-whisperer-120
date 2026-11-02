type ChangeRow = { sector_id?: unknown; fb_std?: unknown; reg?: { changed?: boolean; old?: unknown; new?: unknown }; crew?: { changed?: boolean; raw_old?: unknown; raw_new?: unknown; out?: string[]; in?: string[] } };

/** A source change must identify this exact operational sector and instant. */
export function cmpSourceChange(rows: ChangeRow[], id: unknown, std: unknown): ChangeRow | null {
  const time = new Date(String(std || '')).getTime();
  if (!Number.isFinite(time)) return null;
  const hits = rows.filter(r => String(r.sector_id) === String(id) && new Date(String(r.fb_std || '')).getTime() === time);
  return hits.length === 1 ? hits[0] ?? null : null;
}

export function cmpAircraftChange(reg: ChangeRow['reg']): boolean {
  const norm = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return !!reg?.changed && !!norm(reg.old) && !!norm(reg.new) && norm(reg.old) !== norm(reg.new);
}

/** Only identifiable operating pilots authorize a crew write. */
export function cmpPilotChanges(oldRaw: unknown, newRaw: unknown) {
  const pilots = (raw: unknown) => {
    const out: Record<string, string> = {};
    const seen = new Set<string>();
    for (const m of String(raw || '').matchAll(/\(([^)]*)\)\s*-?\s*(\d{3,6})/g)) {
      const role = String(m[1] || '').toUpperCase();
      if (/DHD/.test(role)) continue;
      const key = /\b(CPT|CAPT|CAPTAIN)\b/.test(role) ? 'cptText' : /\b(FO|F\/O|FIRST OFFICER)\b/.test(role) ? 'foText' : '';
      if (key) { out[key] = seen.has(key) ? '' : String(m[2] || '').replace(/^0+/, ''); seen.add(key); }
    }
    return out;
  };
  const old = pilots(oldRaw), next = pilots(newRaw);
  return ['cptText', 'foText'].filter(key => next[key] && old[key] !== next[key]).map(key => ({key, from: old[key] || '', to: next[key]}));
}

/** Pick distinct numeric revisions from one operating date, never upload order. */
export function cmpFplPair<T extends { name: string; modified?: number }>(files: T[], now = Date.now()): T[] {
  const reference = new Date(now);
  const year = reference.getUTCFullYear();
  const candidates = files.flatMap(file => {
    const ver = /\bVER\D{0,3}(\d+)/i.exec(file.name);
    const date = /\bON\s*(\d{1,2})\s*([A-Z]{3})(?:\s+(20\d{2}))?/i.exec(file.name);
    if (!ver || !date) return [];
    const month = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(String(date[2]).toUpperCase());
    const day = Number(date[1]);
    if (month < 0 || day < 1 || day > 31) return [];
    const years = date[3] ? [Number(date[3])] : [year - 1, year, year + 1];
    const dates = years.map(y => Date.UTC(y, month, day)).filter(t => new Date(t).getUTCMonth() === month);
    dates.sort((a,b) => Math.abs(a - now) - Math.abs(b - now));
    const stamp = dates[0];
    if (stamp === undefined) return [];
    return [{file, stamp, revision: Number(ver[1])}];
  });
  candidates.sort((a,b) => b.stamp - a.stamp || b.revision - a.revision || Number(b.file.modified || 0) - Number(a.file.modified || 0));
  const latest = candidates[0];
  if (!latest) return [];
  const previous = candidates.find(c => c.stamp === latest.stamp && c.revision < latest.revision);
  return previous ? [previous.file, latest.file] : [];
}

export function patchCmpSyncPage(html: string): string {
  return html.replace('function renderCompareTable(d, opts){', `
const cmpSourceChange = ${cmpSourceChange.toString()};
const cmpAircraftChange = ${cmpAircraftChange.toString()};
const cmpPilotChanges = ${cmpPilotChanges.toString()};
const cmpFplPair = ${cmpFplPair.toString()};
let cmpSyncSources = {stamp:"", crew:[], fpl:[]}, cmpSyncBusy = false, cmpSyncSeq = 0;
const cmpSyncChecks = new Map();
let cmpSyncRowSource = null, cmpSyncRowIndex = new Map();
function cmpSyncRow(sid){
  const rows = (lastCmp && lastCmp.table) || [];
  if(rows !== cmpSyncRowSource){cmpSyncRowSource=rows;cmpSyncRowIndex=new Map(rows.map(r=>[String(r.sector_id),r]));}
  return cmpSyncRowIndex.get(String(sid));
}
function cmpSyncEvidence(r, kind){
  const f = cmpActionFlight(r);
  if(!f) return null;
  if(cmpSyncSources.current !== ((xls && xls.file) || cmpSyncSources.current)) return null;
  const row = cmpSourceChange(kind === "fpl" ? cmpSyncSources.fpl : cmpSyncSources.crew, f.id, f.std);
  if(!row || !(kind === "crew" ? row.crew && row.crew.changed : cmpAircraftChange(row.reg))) return null;
  const bound = cmpBind[String(r.sector_id)];
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if(kind === "aims" && norm(((bound && bound.reg) || r.reg_cmp || {}).excel) !== norm(row.reg.new)) return null;
  if(kind === "crew" && bound && bound.crew && String(bound.crew.excel || "").trim() !== String(row.crew.raw_new || "").trim()) return null;
  return {f, row, kind, changes: kind === "crew" ? cmpPilotChanges(row.crew.raw_old, row.crew.raw_new) : []};
}
function cmpSyncKey(e){ return JSON.stringify([e.f.id,e.f.callsign,e.f.std,e.f.dep_icao,e.f.dest_icao,e.kind,e.row.reg,e.row.crew]); }
function cmpSyncIdentity(e){ return {sector_id:e.f.id,flt:e.f.callsign,date:new Date(e.f.std).toISOString().slice(0,10),dep:e.f.dep_icao || e.f.dep,arr:e.f.dest_icao || e.f.dest,crew_changes:e.changes}; }
async function cmpSyncCheck(e){
  const response = await fetch("/api/version/fbreg", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:[cmpSyncIdentity(e)]})});
  const d = await response.json(), it = d.items && d.items[0];
  if(!response.ok || d.error || !it || !it.found || String(it.sector_id) !== String(e.f.id)) throw new Error(d.error || (it && it.error) || "Không tìm thấy đúng chuyến/ngày/chặng.");
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let ok;
  if(e.kind === "crew"){
    if(!e.changes.length || !it.crew_checked) throw new Error(it.crew_error || "Chưa đọc được mã/vai trò phi công — không gửi thay đổi.");
    ok = e.changes.every(c => (it.crew_changes || []).some(x => x.key === c.key && x.from === c.from && x.to === c.to && x.ok));
  }else ok = !!it.reg && norm(it.reg) === norm(e.row.reg.new);
  cmpSyncChecks.set(cmpSyncKey(e), {ok});
  return ok;
}
function cmpSyncPaint(r, kind){
  const attr = kind === "crew" ? "data-crew-sid" : kind === "aims" ? "data-reg-sid" : "data-fpl-reg-sid";
  const td = document.querySelector('#cmpBody td[' + attr + '="' + r.sector_id + '"]');
  if(!td) return;
  td.querySelectorAll(".cmp-sync-action,.cmp-sync-pick").forEach(b => b.remove());
  Array.from(td.children).forEach(el => {el.hidden = false;});
  const e = cmpSyncEvidence(r, kind);
  if(!e) return;
  const checked = cmpSyncChecks.get(cmpSyncKey(e));
  const b = document.createElement("button"); b.type = "button";
  const ok = checked && checked.ok;
  b.className = "regbtn cmp-sync-action" + (ok ? " synced" : "");
  b.textContent = kind === "crew" ? (ok ? "✓ Crew" : "↻ Crew") : e.row.reg.new;
  b.disabled = !!ok || cmpSyncBusy || (kind === "crew" && !e.changes.length);
  b.setAttribute("aria-label", (kind === "crew" ? "Đổi crew " : "Đổi tàu ") + e.f.callsign + " theo " + (kind === "fpl" ? "FPL mới" : "Crewlist mới"));
  b.dataset.tip = (kind === "crew" ? String(e.row.crew.raw_old || "") + " → " + String(e.row.crew.raw_new || "") : e.row.reg.old + " → " + e.row.reg.new)
    + (ok ? " · Đã khớp FliteBrief" : kind === "crew" && !e.changes.length ? " · Chưa đọc được mã/vai trò phi công" : " · Bấm xem trước và xác nhận");
  b.onclick = ev => {ev.stopPropagation(); cmpSyncOpen(r, kind);};
  if(kind === "crew") td.prepend(b);
  else if(kind === "fpl") td.replaceChildren(b);
  else { Array.from(td.children).forEach(el => {if(!el.classList.contains("cmp-sync-pick")) el.hidden = true;}); td.prepend(b); }
  if(kind !== "fpl" && xls && xls.file){
    const pick = document.createElement("button"); pick.type = "button"; pick.className = "cmp-sync-pick"; pick.textContent = "≡";
    pick.setAttribute("aria-label", "Chọn dòng Crewlist " + e.f.callsign); pick.dataset.tip = "Chọn dòng Crewlist";
    pick.onclick = ev => {ev.stopPropagation();cmpOpenPick(r.sector_id,td);}; td.appendChild(pick);
  }
}
function cmpMsgPaint(r){
  const td = document.querySelector('#cmpBody td[data-cmp-msg-sid="' + r.sector_id + '"]');
  const menu = td && td.querySelector("select.cmp-message-select");
  if(!menu) return;
  td.querySelectorAll(".cmp-msg-quick").forEach(b => b.remove());
  menu.hidden = false;
  const f = cmpActionFlight(r);
  const row = f && cmpSyncSources.current === ((xls && xls.file) || cmpSyncSources.current) ? cmpSourceChange(cmpSyncSources.fpl, f.id, f.std) : null;
  const raw = String((row && row.atc && row.atc.kind) || "").toUpperCase();
  const kind = raw === "CHG DLA" ? "CHG DLA" : raw === "CHG" ? "CHG A/C" : raw === "DLA" ? "DLA" : "";
  if(!kind) return;
  const b = document.createElement("button"); b.type = "button"; b.className = "cmp-msg-quick";
  b.textContent = kind === "CHG A/C" ? "CHG" : kind;
  b.dataset.tip = "FPL mới so với FPL cũ: " + kind + " · Bấm để soạn điện văn";
  b.setAttribute("aria-label", "Soạn " + kind + " " + f.callsign);
  b.disabled = menu.disabled;
  b.onclick = ev => {ev.stopPropagation(); menu.value = kind; menu.onchange();};
  menu.hidden = true; td.prepend(b);
}
function cmpSyncRepaint(rows){ for(const r of (rows || ((lastCmp && lastCmp.table) || []))){ for(const kind of ["crew","aims","fpl"]) cmpSyncPaint(r,kind); cmpMsgPaint(r); } }
async function cmpSyncOpen(r, kind){
  if(cmpSyncBusy) return;
  const e = cmpSyncEvidence(r, kind); if(!e) {alert("Dữ liệu chuyến đã thay đổi — bấm Cmp lại.");return;}
  cmpSyncBusy = true; cmpSyncRepaint();
  try{
    if(await cmpSyncCheck(e)) return;
    const crew = kind === "crew", base = crew ? "/api/crewswap" : "/api/regswap";
    const params = {sector_id:e.f.id,days:2};
    if(crew){params.out=e.changes.map(c=>c.from).filter(Boolean);params.in=e.changes.map(c=>c.to);}
    else {params.old_reg=e.row.reg.old;params.new_reg=e.row.reg.new;}
    const p = new URLSearchParams(); Object.entries(params).forEach(([k,v])=>p.set(k,Array.isArray(v)?v.join(","):String(v)));
    const response = await fetch(base + "/preview?" + p), d = await response.json();
    if(!response.ok || d.error) throw new Error(d.error || "Không xem trước được thay đổi.");
    if(crew && (d.not_found || []).length) throw new Error("Không tìm thấy phi công: " + d.not_found.map(x=>x.username).join(", "));
    const L = [e.f.callsign + " · " + new Date(e.f.std).toISOString().slice(0,10) + " · " + (e.f.dep_icao || r.dep) + " → " + (e.f.dest_icao || r.arr),
      crew ? "Crewlist: " + e.row.crew.raw_old + " → " + e.row.crew.raw_new : "Tàu: " + e.row.reg.old + " → " + e.row.reg.new];
    for(const x of (crew ? d.remove : d.delete) || []) L.push("− " + (x.label || x.username || x.filename));
    for(const x of d.add || []) L.push("+ " + (x.label || x.username || x.title) + (x.found === false ? " (thiếu file)" : ""));
    if(!crew) L.push("Thao tác giống tab Dữ liệu thay đổi: cập nhật file đính kèm theo tàu mới; không sửa tàu của OFP.");
    if(!confirm(L.join("\\n") + "\\n\\nXác nhận cập nhật lên FliteBrief?")) return;
    if(!cmpSyncEvidence(r,kind) || cmpSyncKey(cmpSyncEvidence(r,kind)) !== cmpSyncKey(e)) throw new Error("Nguồn đã thay đổi — bấm Cmp rồi thử lại.");
    if(await cmpSyncCheck(e)) return;
    const run = await fetch(base + "/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
    const job = await run.json(); if(!run.ok || job.error || !job.id) throw new Error(job.error || "Không gửi được thay đổi.");
    const complete = await ftStream(job.id); await cmpSyncCheck(e);
    if(!complete) throw new Error("Chưa cập nhật xong — xem nhật ký.");
    if(!cmpSyncChecks.get(cmpSyncKey(e)).ok) alert("Đã xử lý; FliteBrief chưa khớp dữ liệu mới nên khung chưa chuyển xanh.");
  }catch(error){alert(error.message || "Không cập nhật được.");}
  finally{cmpSyncBusy=false;cmpSyncRepaint();}
}
async function cmpReadSyncSources(){
  const seq = ++cmpSyncSeq;
  try{
    const response = await fetch("/api/version/files"), d = await response.json();
    if(!response.ok || d.error || seq !== cmpSyncSeq) return;
    const files = d.files || [], current = (xls && xls.file) || d.current;
    const crews = files.filter(f=>!(/\\bVER\\s*\\d+/i.test(f.name)));
    const ix = crews.findIndex(f=>f.name===current);
    const pairs = {crew: ix>=0 && crews[ix+1] ? [crews[ix+1],crews[ix]] : [], fpl:cmpFplPair(files)};
    const stamp = JSON.stringify([current,pairs]);
    if(cmpSyncSources.stamp !== stamp){
      const results = await Promise.all(["crew","fpl"].map(async kind=>{
        if(pairs[kind].length!==2) return [];
        const p = new URLSearchParams({old:pairs[kind][0].name,new:pairs[kind][1].name});
        const res = await fetch("/api/version/diff?"+p), diff = await res.json();
        if(!res.ok || diff.error) throw new Error(diff.error || "Chưa đọc được phiên bản.");
        return diff.rows || [];
      }));
      if(seq!==cmpSyncSeq) return;
      cmpSyncSources={stamp,current,crew:results[0],fpl:results[1]};
    }
    const targets = ((lastCmp && lastCmp.table) || []).flatMap(r=>["crew","aims","fpl"].map(kind=>cmpSyncEvidence(r,kind)).filter(Boolean));
    cmpSyncRepaint();
    for(let i=0;i<targets.length;i+=4){
      if(seq!==cmpSyncSeq) return;
      const batch = targets.slice(i,i+4);
      await Promise.all(batch.map(async e=>{try{await cmpSyncCheck(e);}catch(_){/* unreadable never means matched */}}));
      if(seq!==cmpSyncSeq) return;
      cmpSyncRepaint([...new Set(batch.map(e=>cmpSyncRow(e.f.id)).filter(Boolean))]);
    }
  }catch(_){/* Source errors do not authorize a new action. */}
}
setInterval(()=>{if(!document.hidden && !cmpSyncBusy && document.querySelector("#cmpBody")?.offsetParent!==null) cmpReadSyncSources();},60000);
const cmpSyncFillCrew = fillCrewCell;
fillCrewCell = function(...args){const td=cmpSyncFillCrew(...args);const r=cmpSyncRow(td.dataset.crewSid);if(r)cmpSyncPaint(r,"crew");return td;};
const cmpSyncFillReg = fillRegCell;
fillRegCell = function(...args){const td=cmpSyncFillReg(...args);const r=cmpSyncRow(td.dataset.regSid);if(r){cmpRegPaint(r);cmpSyncPaint(r,"aims");}return td;};
function renderCompareTable(d, opts){`)
    .replace('  cmpOpsRepaint(rows);', '  cmpReadSyncSources();\n  cmpOpsRepaint(rows);')
    .replace('function cmpRegRepaint(){', 'function cmpRegRepaint(){\n  cmpSyncRepaint();')
    .replace('  td.title = "FPL: "', '  cmpSyncPaint(r, "fpl");\n  td.title = "FPL: "')
    .replace('</head>', `<style>
.cmptbl .cmp-sync-action{display:inline-flex;align-items:center;justify-content:center;min-width:70px;min-height:30px;padding:4px 9px;border:2px solid var(--red)!important;border-radius:7px;background:var(--panel)!important;color:var(--red)!important;-webkit-text-fill-color:currentColor!important;font-family:inherit;font-weight:800;font-size:12px;line-height:1.3;cursor:pointer;letter-spacing:0}
.cmptbl .cmp-sync-action.synced{border-color:var(--green)!important;background:var(--green)!important;color:var(--atc-on-color)!important;opacity:1}
.cmptbl .cmp-sync-action:disabled:not(.synced){opacity:.55;cursor:default}
.cmptbl .cmp-sync-action:focus-visible,.cmptbl .cmp-sync-pick:focus-visible{outline:2px solid var(--red);outline-offset:3px}
.cmptbl .cmp-msg-quick{min-width:70px;min-height:30px;padding:4px 10px;border:0;border-radius:7px;background:var(--red);color:#fff;font:800 12px/1.3 inherit;cursor:pointer}
.cmptbl .cmp-msg-quick:disabled{opacity:.55}
.cmptbl .cmp-sync-pick{border:0;background:transparent;color:var(--text);font-size:18px;padding:4px;cursor:pointer;vertical-align:middle}
</style></head>`);
}