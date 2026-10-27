/** Compare tab: one Validation column summarising FUEL/TOW/LWT/ZFW/ETP/CONT-ERA; source cells stay hidden for hover data. */
export function cmpValidationVerdict(items: { label: string; level: 'ok' | 'warn' | 'bad' | 'pending' }[]) {
  if (items.some((i) => i.level === 'bad')) return 'bad';
  if (items.some((i) => i.level === 'warn')) return 'warn';
  if (items.some((i) => i.level === 'pending')) return 'pending';
  return 'good';
}

export function patchCmpValidationPage(html: string): string {
  return html
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 3.08')
    .replace('["REG", "Số tàu FliteBrief. Xanh = khớp Excel, đỏ + ! = lệch."],', '["REG FPL", "Số tàu trên FliteBrief của đúng chuyến."],\n  ["REG AIMS", "Số tàu từ Crewlist/Excel AIMS. Xanh = khớp FliteBrief; đỏ = lệch."],')
    .replace('    tr.appendChild(regCmpCell(r));', `    tr.appendChild(txtCell(r.reg || "—", "n"));
    const aimsCell = regCmpCell(r);
    const aimsReg = r.reg_cmp && r.reg_cmp.excel;
    const aimsValue = aimsCell.querySelector(".cmp-reg,.v");
    if(aimsValue) aimsValue.textContent = aimsReg || "—";
    tr.appendChild(aimsCell);`)
    .replace('    tr.onclick = () => {\n      current = r.sector_id;', `    const actionFlight = cmpActionFlight(r);
    const briefCell = document.createElement("td");
    const verifyCell = document.createElement("td");
    if(actionFlight){
      const actionRow = {sector_id: actionFlight.id, fb_callsign: actionFlight.callsign,
        flt: actionFlight.callsign, fb_std: actionFlight.std, ops_ok: true,
        ofp_ack: !!actionFlight.ofp_ack,
        reg: {old: (r.reg_cmp && r.reg_cmp.excel) || "", new: actionFlight.reg, changed: true}};
      if(actionFlight.reg){
        const briefButton = document.createElement("button");
        briefButton.className = "briefbtn";
        briefButton.textContent = "Đổi BF";
        briefButton.title = "Đổi Briefing " + actionFlight.callsign + " · " + actionFlight.reg;
        briefButton.onclick = ev => { ev.stopPropagation(); bsOpen(actionRow, briefButton); };
        vPaintDone("brief", actionRow, briefButton);
        briefCell.appendChild(briefButton);
      }else briefCell.textContent = "—";
      const existingVerify = vVerifyCell(actionRow);
      verifyCell.replaceChildren(...existingVerify.childNodes);
    }else{
      briefCell.textContent = "—"; verifyCell.textContent = "—";
      briefCell.title = verifyCell.title = "Chưa xác định được đúng chuyến trong khung khai thác";
    }
    tr.append(briefCell, verifyCell);
    tr.onclick = () => {
      current = r.sector_id;`)
    .replace('function renderCompareTable(d, opts){', `
function cmpActionFlight(r){
  const hits = (flights || []).filter(f => String(f.id) === String(r.sector_id)
    && f.callsign === r.callsign && inOpsWindow(f));
  return hits.length === 1 ? hits[0] : null;
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
</style></head>`);
}
