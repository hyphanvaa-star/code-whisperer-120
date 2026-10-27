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

export function patchCmpValidationPage(html: string): string {
  return html
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 3.09')
    .replace('["REG", "Số tàu FliteBrief. Xanh = khớp Excel, đỏ + ! = lệch."],', '["REG FPL", "Số tàu trên FliteBrief của đúng chuyến."],\n  ["REG AIMS", "Số tàu từ Crewlist/Excel AIMS. Xanh = khớp FliteBrief; đỏ = lệch."],')
    .replace('const reg = pickReg(cell && cell.flite) || pickReg(cell && cell.excel) || pickReg(fallback) || "—";', 'const reg = pickReg(cell && cell.excel) || "—";')
    .replace('    tr.appendChild(regCmpCell(r));', `    const fplCell = txtCell("…", "n");
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
    }else{
      briefCell.textContent = "—"; verifyCell.textContent = "—";
      briefCell.title = verifyCell.title = "Chưa xác định được đúng chuyến trong khung khai thác";
    }
    briefCell.dataset.cmpBriefSid = r.sector_id;
    tr.append(briefCell, verifyCell);
    tr.onclick = () => {
      current = r.sector_id;`)
    .replace('function renderCompareTable(d, opts){', `
function cmpActionFlight(r){
  const hits = (flights || []).filter(f => String(f.id) === String(r.sector_id)
    && f.callsign === r.callsign && inOpsWindow(f));
  return hits.length === 1 ? hits[0] : null;
}
const cmpRegState = ${cmpRegState.toString()};
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
    .replace('  fillWeights(rows, !!opts.refreshWeights);', '  cmpReadFplRegs(rows);\n  fillWeights(rows, !!opts.refreshWeights);')
    .replace('  vLast = d;', '  vLast = d;\n  cmpRegRepaint();')
    .replace('  cmpArmPick(td, td.dataset.regSid);\n  return td;\n}\n\nfunction crewCmpCell', '  cmpArmPick(td, td.dataset.regSid);\n  cmpRegRepaint();\n  return td;\n}\n\nfunction crewCmpCell')
    .replace('    + "FALSE nếu Cont Fuel hoặc ERA lệch — hoặc cả hai."],', '    + "FALSE nếu Cont Fuel hoặc ERA lệch — hoặc cả hai."],\n  ["VALIDATION", "Gộp FUEL, TOW, LWT, ZFW, CONT/ERA, ETP."],\n  ["ĐỔI BRIEFING", "Xem trước rồi xác nhận đổi Briefing cho đúng chuyến và tàu FliteBrief hiện tại."],\n  ["VERIFY", "Verify chuyến có tam giác đỏ OFP mới."],')
    .replace(`    for(const k of ["ezfw", "etp", "rres"]){
      const td = document.createElement("td");
      td.dataset.w = k;
      td.dataset.sid = r.sector_id;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`, `    for(const k of ["ezfw", "etp", "rres", "val"]){
      const td = document.createElement("td");
      td.dataset.w = k;
      td.dataset.sid = r.sector_id;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`)
    .replace('  paintDelta(sid);\n}\n\n/* EST (Omni)', '  paintDelta(sid);\n  cmpValPaint(sid);\n}\n\n/* EST (Omni)')
    .replace('</head>', `<style>
.cmptbl :is(th,td):nth-child(10),.cmptbl :is(th,td):nth-child(n+14):nth-child(-n+18){display:none!important}
.cmptbl td[data-w="val"]{min-width:150px;font-size:12px;line-height:1.35}
.cmptbl .cmp-val-head{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;background:#e5e7eb;color:#374151}
.cmptbl td[data-val="good"] .cmp-val-head{background:#16a34a;color:#fff}
.cmptbl td[data-val="warn"] .cmp-val-head{background:#facc15;color:#422006}
.cmptbl td[data-val="bad"] .cmp-val-head{background:#dc2626;color:#fff}
.cmptbl .cmp-val-line{margin-top:3px;font-weight:600;white-space:nowrap}
.cmptbl .cmp-val-line.warn{color:#a16207}.cmptbl .cmp-val-line.bad{color:#dc2626}
.cmptbl td.cmp-fpl-match,.cmptbl td.cmp-fpl-match *{color:var(--green)!important;font-weight:800}
.cmptbl td.cmp-fpl-mismatch,.cmptbl td.cmp-fpl-mismatch *{color:var(--red)!important}
.cmptbl .briefbtn:disabled{opacity:.35;cursor:not-allowed}
</style></head>`);
}
