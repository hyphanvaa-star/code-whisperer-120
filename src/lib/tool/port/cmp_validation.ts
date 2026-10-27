/** Compare tab: one Validation column summarising FUEL/TOW/LWT/ZFW/ETP/CONT-ERA; source cells stay hidden for hover data. */
export function cmpValidationVerdict(items: { label: string; level: 'ok' | 'warn' | 'bad' | 'pending' }[]) {
  if (items.some((i) => i.level === 'bad')) return 'bad';
  if (items.some((i) => i.level === 'warn')) return 'warn';
  if (items.some((i) => i.level === 'pending')) return 'pending';
  return 'good';
}

export function cmpRegState(fpl: unknown, flite: unknown, aims: unknown, versionChanged = false) {
  const norm = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const p = norm(fpl), f = norm(flite), a = norm(aims);
  return {
    same: !!p && !!f && p === f,
    changed: !!f && (versionChanged || (!!p && p !== f) || (!!a && a !== f)),
  };
}

export function cmpAtcStatus(result: { callsign?: string; dof?: string; status?: string; error?: string }, callsign: string, dof: string) {
  if (result.callsign?.toUpperCase() !== callsign.toUpperCase() || result.dof !== dof) return '';
  return result.error ? '' : result.status || '';
}

export function patchCmpValidationPage(html: string): string {
  return html
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 3.20')
    .replace('    tr.appendChild(cs);\n    tr.appendChild(routeCmpCell(r));', `    cs.dataset.cmpCallsignSid = r.sector_id;
    const opsStatus = document.createElement("div");
    opsStatus.dataset.cmpOpsSid = r.sector_id;
    cs.appendChild(opsStatus);
    tr.appendChild(cs);
    tr.appendChild(routeCmpCell(r));`)
    .replace('["REG", "Số tàu FliteBrief. Xanh = khớp Excel, đỏ + ! = lệch."],', '["ATC STATUS", "Trạng thái ATC trên AviWeb đúng ngày/chặng."],\n  ["REG FPL", "Số tàu trên FliteBrief của đúng chuyến."],\n  ["REG AIMS", "Số tàu từ Crewlist/Excel AIMS. Xanh = khớp FliteBrief; đỏ = lệch."],')
    .replace('const reg = pickReg(cell && cell.flite) || pickReg(cell && cell.excel) || pickReg(fallback) || "—";', 'const reg = pickReg(cell && cell.excel) || "—";')
    .replace('    tr.appendChild(regCmpCell(r));', `    const atcCell = txtCell("…", "q");
    atcCell.dataset.cmpAtcSid = r.sector_id;
    tr.appendChild(atcCell);
    const fplCell = txtCell("…", "n");
    fplCell.dataset.fplRegSid = r.sector_id;
    tr.appendChild(fplCell);
    const aimsCell = regCmpCell(r);
    tr.appendChild(aimsCell);`)
    .replace('    tr.onclick = () => {\n      current = r.sector_id;', `    const actionFlight = cmpActionFlight(r);
    const briefCell = document.createElement("td");
    const verifyCell = document.createElement("td");
    if(actionFlight){
      const actionRow = {sector_id: actionFlight.id, fb_callsign: actionFlight.callsign,
        flt: actionFlight.callsign, fb_std: actionFlight.std, ops_ok: true,
        ofp_ack: !!actionFlight.ofp_ack,
        reg: {old: (r.reg_cmp && r.reg_cmp.excel) || "", new: actionFlight.reg, changed: false}};
      if(actionFlight.reg){
        const briefButton = document.createElement("button");
        briefButton.className = "briefbtn";
        briefButton.disabled = true;
        briefButton.textContent = "Đổi BF";
        briefButton.title = "Đổi Briefing " + actionFlight.callsign + " · " + actionFlight.reg;
        briefButton.onclick = ev => { ev.stopPropagation(); if(!briefButton.disabled) bsOpen(actionRow, briefButton); };
        vPaintDone("brief", actionRow, briefButton);
        briefCell.appendChild(briefButton);
        briefCell._cmpBrief = {row: actionRow, button: briefButton};
      }else briefCell.textContent = "—";
      const existingVerify = vVerifyCell(actionRow);
      verifyCell.replaceChildren(...existingVerify.childNodes);
      if(actionRow.ofp_ack){
        const quick = document.createElement("button");
        quick.type = "button";
        quick.className = "cmp-vf";
        quick.textContent = "✔";
        quick.title = "Verify nhanh " + actionFlight.callsign
          + " — acknowledge tam giác đỏ OFP rồi cho chuyến lên xanh";
        quick.onclick = ev => {
          ev.stopPropagation();
          csQuickVerify(actionFlight, quick, ok => {
            if(!ok) return;
            r.ofp_ack = false; actionRow.ofp_ack = false;
            vMarkDone("verify", actionRow, quick);
          });
        };
        vPaintDone("verify", actionRow, quick);
        verifyCell.prepend(quick);
      }
    }else{
      briefCell.textContent = "—"; verifyCell.textContent = "—";
      briefCell.title = verifyCell.title = "Chưa xác định được đúng chuyến trong khung khai thác";
    }
    briefCell.dataset.cmpBriefSid = r.sector_id;
    const messageCell = document.createElement("td");
    if(actionFlight){
      const menu = document.createElement("select");
      menu.className = "cmp-message-select";
      menu.setAttribute("aria-label", "Điện văn " + actionFlight.callsign);
      for(const kind of ["", "CHG A/C", "DLA", "CHG DLA"]){
        const option = document.createElement("option");
        option.value = kind; option.textContent = kind || "Điện văn…";
        menu.appendChild(option);
      }
      menu.onclick = ev => ev.stopPropagation();
      menu.onchange = async () => {
        const kind = menu.value; menu.value = "";
        if(!kind) return;
        const f = cmpActionFlight(r);
        if(!f){ alert("Chưa xác định được đúng chuyến trong khung khai thác"); return; }
        menu.disabled = true;
        try{
          const response = await fetch("/api/fpltext/msg", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({kind, items: [{sector_id: f.id, flt: f.callsign,
              date: new Date(f.std).toISOString().slice(0,10), dep: r.dep, arr: r.arr}]})});
          const d = await response.json();
          if(!response.ok || d.error) throw new Error(d.error || "Không lấy được điện văn");
          ftOpenAtcReview(d);
        }catch(error){ alert(error.message || "Không lấy được điện văn"); }
        finally{ menu.disabled = false; }
      };
      messageCell.appendChild(menu);
    }else messageCell.textContent = "—";
    tr.append(messageCell, briefCell, verifyCell);
    tr.onclick = () => {
      current = r.sector_id;`)
    .replace('function renderCompareTable(d, opts){', `
function cmpActionFlight(r){
  const hits = (flights || []).filter(f => String(f.id) === String(r.sector_id)
    && f.callsign === r.callsign && inOpsWindow(f));
  return hits.length === 1 ? hits[0] : null;
}
const cmpRegState = ${cmpRegState.toString()};
function cmpOpsRepaint(rows){
  for(const r of (rows || ((lastCmp && lastCmp.table) || []))){
    const target = document.querySelector('#cmpBody [data-cmp-ops-sid="' + r.sector_id + '"]');
    if(!target) continue;
    const f = cmpActionFlight(r);
    if(!f){ target.replaceChildren(); continue; }
    paintOpsStatus(target, f);
    target.classList.add("cmp-ops-status");
  }
}
const cmpAtcStatus = ${cmpAtcStatus.toString()};
const cmpAtcCache = new Map();
let cmpAtcBusy = false;
function cmpAtcKey(f){ return JSON.stringify([f.id, f.callsign, f.std, f.dep_icao, f.dest_icao]); }
function cmpAtcTone(s){
  s = String(s || "").toUpperCase();
  if(!s) return "none";
  if(/REJ|CNL|CANCEL|ERR|FAIL/.test(s)) return "bad";
  if(/CLOS|ARR|LAND|COMPLET/.test(s)) return "done";
  if(/DEP|AIR|ACT/.test(s)) return "air";
  if(/FILE|APPR|PROC|ACK|ACCEPT/.test(s)) return "ok";
  if(/DLA|DELAY|CHG|UNPROC|PEND|WAIT/.test(s)) return "warn";
  return "info";
}
function cmpAtcPaint(r){
  const td = document.querySelector('#cmpBody td[data-cmp-atc-sid="' + r.sector_id + '"]');
  if(!td) return;
  const f = cmpActionFlight(r), cached = f && cmpAtcCache.get(cmpAtcKey(f));
  const text = cached ? cached.status || "Chưa có" : f ? (cmpAtcBusy ? "…" : "—") : "—";
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const wrongReg = !!(cached && cached.status && cached.reg && f && f.reg && norm(cached.reg) !== norm(f.reg));
  const tone = cached ? (wrongReg ? "bad" : cmpAtcTone(cached.status)) : "none";
  td.className = "cmp-atc-cell";
  let pill = td.firstElementChild;
  if(!pill || !pill.classList.contains("cmp-atc-pill")){ pill = document.createElement("span"); td.replaceChildren(pill); }
  if(pill.textContent !== text) pill.textContent = text;
  pill.className = "cmp-atc-pill t-" + tone;
  td.title = wrongReg ? "Sai tàu: AviWeb " + cached.reg + " ≠ FliteBrief " + f.reg : cached ? cached.error || "AviWeb · " + new Date(cached.time).toISOString() : "Bấm ATC check để đọc AviWeb";
}
function cmpAtcPut(f, status, error, reg){
  const key = cmpAtcKey(f), prev = cmpAtcCache.get(key);
  if(!status && prev && prev.status) cmpAtcCache.set(key, {...prev, time: Date.now(), error: ""});
  else cmpAtcCache.set(key, {status, error, reg: reg || "", time: Date.now()});
}
function cmpAtcRepaint(){ for(const r of ((lastCmp && lastCmp.table) || [])) cmpAtcPaint(r); }
async function cmpReadAtc(rows){
  rows.forEach(cmpAtcPaint);
  if(cmpAtcBusy) return;
  const targets = rows.map(r => ({r, f: cmpActionFlight(r)})).filter(x => x.f);
  const todo = targets.filter(x => {
        return targets.filter(y => y.f.callsign === x.f.callsign).length === 1;
  });
  if(!todo.length) return;
  cmpAtcBusy = true;
  const btn = document.getElementById("cmpAtcBtn");
  if(btn){ btn.disabled = true; btn.textContent = "Đang check…"; }
  cmpAtcRepaint();
  const finish = () => { cmpAtcBusy = false; if(btn){ btn.disabled = false; btn.textContent = "ATC check"; } cmpAtcRepaint(); };
  const fail = message => {
    for(const {f} of todo) cmpAtcPut(f, "", message);
    finish();
  };
  try{
    const response = await fetch("/api/atc/check", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({callsigns: todo.map(x => x.f.callsign), items: todo.map(({r,f}) => ({
        sector_id: f.id, flt: f.callsign, date: new Date(f.std).toISOString().slice(0,10), dep: r.dep, arr: r.arr}))})});
    const d = await response.json();
    if(!response.ok || d.error || !d.id) throw new Error(d.error || "Không đọc được AviWeb");
    const stream = new EventSource("/api/stream?id=" + encodeURIComponent(d.id));
    const timeout = setTimeout(() => { stream.close(); fail("AviWeb chưa trả kết quả — bấm Cmp để thử lại"); }, 120000);
    stream.onmessage = event => {
      let m; try { m = JSON.parse(event.data); } catch(_){ return; }
      if(m.type !== "end") return;
      clearTimeout(timeout); stream.close();
      for(const {f} of todo){
        const hits = (m.results || []).filter(result => String(result.callsign).toUpperCase() === f.callsign.toUpperCase());
        const result = hits.length === 1 ? hits[0] : null;
        const status = result ? cmpAtcStatus(result, f.callsign, acDofFromStd(f.std)) : "";
        cmpAtcPut(f, status, status ? "" : (result && result.error) || "Chưa có trạng thái đúng ngày/chặng trên AviWeb", status && result ? result.reg : "");
      }
      finish();
    };
    stream.onerror = () => { clearTimeout(timeout); stream.close(); fail("Không kết nối được AviWeb — bấm Cmp để thử lại"); };
  }catch(error){ fail(error.message || "Không đọc được AviWeb"); }
}
const cmpNotes = new Map();
function cmpNoteCell(r){
  const td = document.createElement("td");
  td.className = "cmp-note-cell";
  const input = document.createElement("textarea");
  input.className = "cmp-note-input";
  input.rows = 2;
  input.setAttribute("aria-label", "NOTE " + r.callsign);
  const f = cmpActionFlight(r);
  let uid = "";
  try { uid = window.parent.__fbUserId ? window.parent.__fbUserId() || "" : ""; } catch(_){}
  const key = JSON.stringify([uid, r.sector_id, r.callsign, f ? f.std : r.std, r.dep, r.arr]);
  const storageKey = "sohee:compare-note:v1:" + key;
  let saved = cmpNotes.get(key);
  if(saved === undefined && uid){
    try { saved = localStorage.getItem(storageKey); } catch(_){}
  }
  input.value = saved == null ? "" : saved;
  input.onclick = ev => ev.stopPropagation();
  input.onkeydown = ev => ev.stopPropagation();
  input.oninput = () => {
    cmpNotes.set(key, input.value);
    if(uid){ try { localStorage.setItem(storageKey, input.value); } catch(_){} }
  };
  td.appendChild(input);
  return td;
}
let cmpRegReadSeq = 0;
const cmpFplRegs = new Map();
function cmpRegPaint(r){
  const f = cmpActionFlight(r);
  const td = document.querySelector('#cmpBody td[data-fpl-reg-sid="' + r.sector_id + '"]');
  if(!td) return;
  const cached = cmpFplRegs.get(String(r.sector_id));
  const reg = f && cached && cached.stamp === ofpStamp(f) ? cached.reg : "";
  const changes = ((typeof vLast !== "undefined" && vLast && vLast.rows) || []).filter(v =>
    String(v.sector_id) === String(r.sector_id) && v.reg && v.reg.changed
    && v.ops_ok !== false && v.fb_std && f && new Date(v.fb_std).getTime() === new Date(f.std).getTime());
  const bound = cmpBind[String(r.sector_id)];
  const aims = ((bound && bound.reg) || r.reg_cmp || {}).excel;
  const state = cmpRegState(reg, f && f.reg, aims, changes.length === 1);
  td.textContent = reg || "—";
  td.classList.toggle("cmp-fpl-match", state.same);
  td.classList.toggle("cmp-fpl-mismatch", !!reg && !!f && !state.same);
  td.title = "FPL: " + (reg || "chưa đọc được") + "\\nFliteBrief: " + ((f && f.reg) || "—");
  const cell = document.querySelector('#cmpBody td[data-cmp-brief-sid="' + r.sector_id + '"]');
  const action = cell && cell._cmpBrief;
  if(action){
    action.row.reg.changed = state.changed;
    action.button.disabled = !state.changed;
    action.button.title = state.changed ? "Đổi Briefing theo tàu hiện tại " + f.reg : "Không đổi tàu — không cần đổi Briefing";
  }
}
function cmpRegRepaint(){
  for(const r of ((lastCmp && lastCmp.table) || [])) cmpRegPaint(r);
}
async function cmpReadFplRegs(rows){
  const seq = ++cmpRegReadSeq;
  for(const r of rows) cmpRegPaint(r);
  const todo = rows.filter(r => {
    const f = cmpActionFlight(r), c = cmpFplRegs.get(String(r.sector_id));
    return f && (!c || c.stamp !== ofpStamp(f));
  });
  for(let i = 0; i < todo.length; i += 12){
    const batch = todo.slice(i, i + 12).map(r => ({r, f: cmpActionFlight(r)})).filter(x => x.f);
    try{
      const d = await (await fetch("/api/fpltext/atc", {method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({convert: true, items: batch.map(({r, f}) => ({sector_id: f.id, flt: f.callsign,
          date: new Date(f.std).toISOString().slice(0,10), dep: r.dep, arr: r.arr}))})})).json();
      if(seq !== cmpRegReadSeq) return;
      if(d.error) continue;
      for(const {r, f} of batch){
        const hits = (d.flights || []).filter(x => String(x.id) === String(f.id));
        if(hits.length !== 1) continue;
        const match = /\\bREG\\/([A-Z0-9-]+)/i.exec(hits[0].original || "");
        if(!match) continue;
        cmpFplRegs.set(String(f.id), {reg: match[1], stamp: ofpStamp(f)});
        cmpRegPaint(r);
      }
    }catch(_){ /* Missing reads never imply a match. */ }
  }
}
const cmpValidationVerdict = ${cmpValidationVerdict.toString()};
const CMP_VAL_KEYS = [["fuel","FUEL"],["tow","TOW"],["lwt","LWT"],["ezfw","ZFW"],["rres","CONT/ERA"],["etp","ETP"]];
function cmpValPaint(sid){
  const td = document.querySelector('#cmpBody td[data-w="val"][data-sid="' + sid + '"]');
  if(!td) return;
  const tr = td.closest("tr"), items = [];
  for(const [k, label] of CMP_VAL_KEYS){
    const c = tr.querySelector('td[data-w="' + k + '"]');
    const t = c ? c.textContent.trim() : "";
    let level = "ok";
    if(!c || !t || /^[—….·]+$/.test(t)) level = k === "etp" ? "ok" : "pending";
    else if(c.querySelector(".bad,.crit,.pcr-hot,.fuel-tight")) level = "bad";
    else if(c.querySelector(".warn,.pcr-near")) level = "warn";
    items.push({label, level, text: (c && c.title) || t});
  }
  const v = cmpValidationVerdict(items);
  td.dataset.val = v;
  td.innerHTML = "";
  const head = document.createElement("div");
  head.className = "cmp-val-head";
  head.textContent = v === "good" ? "Good" : v === "bad" ? "Cảnh báo đỏ" : v === "warn" ? "Tiệm cận" : "Chờ dữ liệu";
  td.appendChild(head);
  for(const i of items) if(i.level === "bad" || i.level === "warn"){
    const line = document.createElement("div");
    line.className = "cmp-val-line " + i.level;
    line.textContent = i.label + ": " + String(i.text).split("\\n")[0];
    td.appendChild(line);
  }
  td.title = items.map(i => i.label + " — " + (i.level === "ok" ? "OK" : i.level === "pending" ? "chưa có" : i.level === "warn" ? "tiệm cận" : "sai") + (i.text ? "\\n  " + String(i.text).replace(/\\n/g, "\\n  ") : "")).join("\\n");
}
function renderCompareTable(d, opts){`)
    .replace('  fillWeights(rows, !!opts.refreshWeights);', '  cmpOpsRepaint(rows);\n  rows.forEach(cmpAtcPaint);\n  cmpReadFplRegs(rows);\n  fillWeights(rows, !!opts.refreshWeights);')
    .replace('    if(changed) render();\n  }catch(_){}\n}\nasync function loadFlights', '    cmpOpsRepaint();\n    if(changed) render();\n  }catch(_){}\n}\nasync function loadFlights')
    .replace('  vLast = d;', '  vLast = d;\n  cmpRegRepaint();')
    .replace('  cmpArmPick(td, td.dataset.regSid);\n  return td;\n}\n\nfunction crewCmpCell', '  cmpArmPick(td, td.dataset.regSid);\n  cmpRegRepaint();\n  return td;\n}\n\nfunction crewCmpCell')
    .replace('    + "FALSE nếu Cont Fuel hoặc ERA lệch — hoặc cả hai."],', '    + "FALSE nếu Cont Fuel hoặc ERA lệch — hoặc cả hai."],\n  ["NOTE", ""],\n  ["VALIDATION", "Gộp FUEL, TOW, LWT, ZFW, CONT/ERA, ETP."],\n  ["ĐIỆN VĂN", ""],\n  ["ĐỔI BRIEFING", "Xem trước rồi xác nhận đổi Briefing cho đúng chuyến và tàu FliteBrief hiện tại."],\n  ["VERIFY", "Verify chuyến có tam giác đỏ OFP mới."],')
    .replace(`    for(const k of ["ezfw", "etp", "rres"]){
      const td = document.createElement("td");
      td.dataset.w = k;
      td.dataset.sid = r.sector_id;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`, `    for(const k of ["ezfw", "etp", "rres", "val"]){
      if(k === "val"){
        tr.appendChild(cmpNoteCell(r));
      }
      const td = document.createElement("td");
      td.dataset.w = k;
      td.dataset.sid = r.sector_id;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`)
    .replace('  paintDelta(sid);\n}\n\n/* EST (Omni)', '  paintDelta(sid);\n  cmpValPaint(sid);\n}\n\n/* EST (Omni)')
    .replace('<span class="dim xls-bar-name crew-using" id="cmpVerBar"', '<button id="cmpAtcBtn" type="button" class="btn" onclick="cmpReadAtc((lastCmp && lastCmp.table) || [])" title="Đọc trạng thái ATC trên AviWeb cho các chuyến trong bảng">ATC check</button> <span class="dim xls-bar-name crew-using" id="cmpVerBar"')
    .replace('</head>', `<style>
.cmptbl :is(th,td):nth-child(11),.cmptbl :is(th,td):nth-child(n+15):nth-child(-n+19){display:none!important}
.cmptbl .cmp-ops-status{margin-top:4px;text-align:left}
.cmptbl .cmp-ops-status .vd{font-size:10px;line-height:1.2;padding:2px 5px;white-space:nowrap}
.cmptbl .cmp-note-cell{min-width:100px;max-width:220px;white-space:normal;overflow-wrap:anywhere}
.cmp-note-input{display:block;width:160px;max-width:100%;min-height:42px;resize:vertical;font:inherit;color:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;padding:5px;box-sizing:border-box}
.cmp-message-select{width:110px;font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--border);border-radius:4px;padding:5px}
.cmptbl td[data-w="val"]{min-width:150px;font-size:12px;line-height:1.35}
.cmptbl .cmp-val-head{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;background:#e5e7eb;color:#374151}
.cmptbl td[data-val="good"] .cmp-val-head{background:#16a34a;color:#fff}
.cmptbl td[data-val="warn"] .cmp-val-head{background:#facc15;color:#422006}
.cmptbl td[data-val="bad"] .cmp-val-head{background:#dc2626;color:#fff}
.cmptbl .cmp-val-line{margin-top:3px;font-weight:600;white-space:nowrap}
.cmptbl .cmp-val-line.warn{color:#a16207}.cmptbl .cmp-val-line.bad{color:#dc2626}
.cmptbl td.cmp-fpl-match,.cmptbl td.cmp-fpl-match *{color:var(--green)!important;font-weight:800}
.cmptbl td.cmp-fpl-mismatch,.cmptbl td.cmp-fpl-mismatch *{color:var(--red)!important}
.cmptbl td.cmp-atc-cell{background:transparent!important;text-align:center;vertical-align:middle}
.cmp-atc-pill{display:inline-flex;align-items:center;gap:5px;min-width:84px;justify-content:center;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.02em;white-space:nowrap;border:1px solid transparent}
.cmp-atc-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.cmp-atc-pill.t-ok{background:#86efac;color:#047857;border-color:#22c55e}
html.night .cmp-atc-pill.t-ok{background:rgba(134,239,172,.18);color:#8ee4b0;border-color:rgba(134,239,172,.45)}
.cmp-atc-pill.t-air{background:#dbeafe;color:#1d4ed8;border-color:#93c5fd}
.cmp-atc-pill.t-done{background:#f1f5f9;color:#475569;border-color:#cbd5e1}
.cmp-atc-pill.t-warn{background:#fef3c7;color:#b45309;border-color:#fcd34d}
.cmp-atc-pill.t-bad{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}
.cmp-atc-pill.t-info{background:#ede9fe;color:#6d28d9;border-color:#c4b5fd}
.cmp-atc-pill.t-none{background:transparent;color:#94a3b8;border-color:#e2e8f0;border-style:dashed}
.cmp-atc-pill.t-none::before{display:none}
.cmptbl .briefbtn:disabled{opacity:.35;cursor:not-allowed}
</style></head>`);
}
