import { patchCmpHandoverPage } from './cmp_handover';
import { patchCmpSyncPage } from './cmp_sync';

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

export function cmpAtcRegIssues(atc: unknown, flite: unknown, aims: unknown) {
  const norm = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = norm(atc);
  if (!a) return [];
  const issues: string[] = [];
  if (flite && norm(flite) && norm(flite) !== a) issues.push('FliteBrief ' + flite);
  if (aims && norm(aims) && norm(aims) !== a && norm(aims) !== norm(flite)) issues.push('Crewlist ' + aims);
  return issues;
}

export function cmpAtcStatus(result: { callsign?: string; dof?: string; status?: string; error?: string }, callsign: string, dof: string) {
  if (result.callsign?.toUpperCase() !== callsign.toUpperCase() || result.dof !== dof) return '';
  return result.error ? '' : result.status || '';
}

export function patchCmpValidationPage(html: string): string {
  return patchCmpSyncPage(patchCmpHandoverPage(html)
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 3.70')
    .replace('    tr.appendChild(cs);\n    tr.appendChild(routeCmpCell(r));', `    cs.dataset.cmpCallsignSid = r.sector_id;
    const opsStatus = document.createElement("div");
    opsStatus.dataset.cmpOpsSid = r.sector_id;
    cs.appendChild(opsStatus);
    tr.appendChild(cs);
    tr.appendChild(routeCmpCell(r));`)
    .replace('["REG", "Số tàu FliteBrief. Xanh = khớp Excel, đỏ + ! = lệch."],', '["ATC STATUS", "Trạng thái ATC trên AviWeb đúng ngày/chặng."],\n  ["REG FPL", "Số tàu theo file Excel FPL VER mới nhất (dự phòng: OFP FliteBrief)."],\n  ["REG AIMS", "Số tàu từ Crewlist/Excel AIMS. Xanh = khớp FliteBrief; đỏ = lệch."],')
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
      if(!actionRow.ofp_ack){
        const af = actionFlight, st = String(af.ofp_status || "").toUpperCase();
        const loaded = !!af.has_ofp || /^(REL|PEN|PRO)$/.test(st);
        const vf = !!(af.verified_by || af.verified_on);
        const fo = af.fuel_order, cap = af.capt_sign || "";
        const tag = document.createElement("span");
        tag.className = "cmp-vst " + (!loaded ? "none" : vf ? "ok" : "wait");
        tag.textContent = !loaded ? "Chưa tải" : vf ? "Đã VF" : "Chưa VF";
        verifyCell.replaceChildren(tag);
        if(fo){ const i = document.createElement("span"); i.className = "cmp-vic fuel"; i.textContent = "⛽"; verifyCell.appendChild(i); }
        if(cap){ const i = document.createElement("span"); i.className = "cmp-vic sign"; i.textContent = "✍"; verifyCell.appendChild(i); }
        const t = (v) => v ? new Date(v).toISOString().slice(11,16) + "Z" : "";
        const escT = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
        const tipRow = (label, v) => '<div class="cmp-tip-row s-tm"><span class="k">' + label + '</span><b>' + escT(v || "—") + '</b></div>';
        verifyCell.dataset.ctip = '<div class="cmp-tip-h">Verify</div>'
          + tipRow("OFP", loaded ? (st || "có") : "chưa tải")
          + tipRow("Verify", vf ? (af.verified_by || "đã verify") + (af.verified_on ? " · " + t(af.verified_on) : "") : "chưa")
          + tipRow("Order dầu", fo ? fo.amount + " " + (fo.units || "KG") : "chưa")
          + tipRow("Capt sign", cap || "chưa");
        cmpTipEnsure();
      }
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
          const atcHit = cmpAtcCache.get(cmpAtcKey(f));
          const response = await fetch("/api/fpltext/msg", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({kind, items: [{sector_id: f.id, flt: f.callsign,
              date: new Date(f.std).toISOString().slice(0,10), dep: r.dep, arr: r.arr,
              avi_eobt: (atcHit && atcHit.status && atcHit.eobt) || "",
              etd_local: r.crew_etd || "", std_local: r.crew_std || ""}]})});
          const d = await response.json();
          if(!response.ok || d.error) throw new Error(d.error || "Không lấy được điện văn");
          ftOpenAtcReview(d);
        }catch(error){ alert(error.message || "Không lấy được điện văn"); }
        finally{ menu.disabled = false; }
      };
      messageCell.appendChild(menu);
      messageCell.dataset.cmpMsgSid = r.sector_id;
    }else messageCell.textContent = "—";
    tr.append(messageCell, briefCell, verifyCell);
    tr.onclick = () => {
      current = r.sector_id;`)
    .replace('function renderCompareTable(d, opts){', `
function cmpActionFlight(r){
  const hits = cmpFlightPool().filter(f => String(f.id) === String(r.sector_id)
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
const cmpAtcRegIssues = ${cmpAtcRegIssues.toString()};
const cmpAtcCache = new Map();
let cmpAtcBusy = false;
function cmpAtcKey(f){ return JSON.stringify([f.id, f.callsign, f.std, f.dep_icao || f.dep, f.dest_icao || f.dest]); }
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
  const f = cmpActionFlight(r);
  if(f && !/^VV/i.test(String(f.dep_icao || f.dep || r.dep || ""))){
    td.className = "cmp-atc-cell"; td.removeAttribute("title"); td.textContent = "—"; return;
  }
  const cached = f && cmpAtcCache.get(cmpAtcKey(f));
  const text = cached ? cached.status || "Chưa có" : f ? (cmpAtcBusy ? "…" : "—") : "—";
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const aims = ((cmpBind[String(r.sector_id)] && cmpBind[String(r.sector_id)].reg) || r.reg_cmp || {}).excel;
  const regIssues = cached && cached.status && cached.reg ? cmpAtcRegIssues(cached.reg, f && f.reg, aims) : [];
  const wrongReg = regIssues.length > 0;
  const tone = cached ? (wrongReg ? "bad" : cmpAtcTone(cached.status)) : "none";
  td.className = "cmp-atc-cell";
  let pill = td.firstElementChild;
  if(!pill || !pill.classList.contains("cmp-atc-pill")){ pill = document.createElement("span"); td.replaceChildren(pill); }
  if(pill.textContent !== text) pill.textContent = text;
  pill.className = "cmp-atc-pill t-" + tone;
  td.removeAttribute("title");
  const esc = v => String(v || "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[c]);
  const fb = f && f.reg, av = cached && cached.reg;
  const row = (cls, label, v) => '<div class="cmp-tip-row ' + cls + '"><span class="k">' + label + '</span><b' + (v && norm(v) !== norm(fb) && fb ? ' class="diff"' : '') + '>' + (v ? esc(v) : '—') + '</b></div>';
  const sd = f && f.std ? new Date(f.std) : null;
  const p2 = n => String(n).padStart(2, "0");
  const dateTxt = sd ? p2(sd.getUTCDate()) + "/" + p2(sd.getUTCMonth()+1) + "/" + sd.getUTCFullYear() : "";
  const stdTxt = sd ? p2(sd.getUTCHours()) + p2(sd.getUTCMinutes()) + "Z" : "";
  const eobt = cached && cached.eobt ? cached.eobt + "Z" : "";
  const plain = (label, v) => '<div class="cmp-tip-row s-tm"><span class="k">' + label + '</span><b>' + (v ? esc(v) : '—') + '</b></div>';
  td.dataset.ctip = '<div class="cmp-tip-h">✈ Số tàu</div>' + row("s-fb","FliteBrief",fb) + row("s-av","AviWeb",av) + row("s-cl","Crewlist",aims)
    + '<div class="cmp-tip-h" style="margin-top:8px">🕒 Ngày · giờ (UTC)</div>' + plain("Ngày bay", dateTxt) + plain("STD FliteBrief", stdTxt) + plain("DOF AviWeb", cached && cached.dof ? "DOF/" + cached.dof : "") + plain("EOBT AviWeb", eobt)
    + '<div class="cmp-tip-f' + (wrongReg ? ' bad' : '') + '">' + (wrongReg ? "Sai tàu: AviWeb ≠ " + esc(regIssues.join(", ")) : cached ? esc(cached.error || "Khớp · " + new Date(cached.time).toISOString().slice(11,16) + "Z") : "Bấm ATC check để đọc AviWeb") + '</div>';
  cmpTipEnsure();
  if(false) td.title = wrongReg ? "Sai tàu: AviWeb " + cached.reg + " ≠ " + regIssues.join(" ≠ ") : cached ? cached.error || "AviWeb · " + new Date(cached.time).toISOString() : "Bấm ATC check để đọc AviWeb";
}
function cmpTipEnsure(){
  if(window.__cmpTip) return;
  const tip = window.__cmpTip = document.createElement("div"); tip.className = "cmp-tip"; document.body.appendChild(tip);
  document.addEventListener("mouseover", e => {
    if(tip.contains(e.target)) return;
    const c = e.target.closest && e.target.closest("td[data-ctip]");
    if(!c){ tip.classList.remove("on"); return; }
    if(typeof tipRelease === "function") tipRelease();
    tip.innerHTML = c.dataset.ctip; tip.classList.toggle("cmp-tip-validation", !!c.dataset.ctipW); tip.classList.add("on");
    const zoom = (parseFloat(document.documentElement.style.zoom) || 1) * (parseFloat(document.body.style.zoom) || 1);
    tip.style.zoom = String(1 / zoom);
    tip.style.maxWidth = Math.max(240, window.innerWidth - 24) + "px";
    tip.style.maxHeight = Math.max(180, window.innerHeight - 24) + "px";
    const b = c.getBoundingClientRect();
    const rect = tip.getBoundingClientRect();
    if(c.dataset.ctipW){
      const lx = b.left - rect.width - 12;
      tip.style.left = Math.max(12, lx >= 12 ? lx : b.right + 12) + "px";
      tip.style.top = Math.max(12, Math.min(window.innerHeight - rect.height - 12, b.top - 8)) + "px";
    }else{
      tip.style.left = Math.max(12, Math.min(window.innerWidth - rect.width - 12, b.left + b.width/2 - rect.width/2)) + "px";
      tip.style.top = Math.max(12, Math.min(window.innerHeight - rect.height - 12, b.bottom + 8)) + "px";
    }
  });
  document.addEventListener("mouseout", e => {
    const c = e.target.closest && e.target.closest("td[data-ctip]");
    if(c && !(e.relatedTarget && (c.contains(e.relatedTarget) || tip.contains(e.relatedTarget)))) tip.classList.remove("on");
  });
  tip.addEventListener("mouseleave", () => tip.classList.remove("on"));
  document.addEventListener("scroll", e => {if(!tip.contains(e.target)) tip.classList.remove("on");}, true);
}
function cmpAtcPut(f, status, error, reg, eobt, dof){
  const key = cmpAtcKey(f), prev = cmpAtcCache.get(key);
  if(!status && prev && prev.status) cmpAtcCache.set(key, {...prev, time: Date.now(), error: ""});
  else cmpAtcCache.set(key, {status, error, reg: reg || "", eobt: eobt || "", dof: dof || "", time: Date.now()});
}
function cmpAtcRepaint(){ for(const r of ((lastCmp && lastCmp.table) || [])) cmpAtcPaint(r); }
let cmpAtcAutoPending = false;
function cmpAtcAutoRun(rows){
  if(!cmpAtcAutoPending || cmpAtcBusy) return;
  const sel = document.getElementById("fDispatcher");
  if(!sel || !sel.value || !rows || !rows.length) return;
  cmpAtcAutoPending = false;
  cmpReadAtc(rows, true);
}
async function cmpReadAtc(rows, quiet){
  rows.forEach(cmpAtcPaint);
  if(cmpAtcBusy) return;
  const targets = rows.map(r => ({r, f: cmpActionFlight(r)})).filter(x => x.f && /^VV/i.test(String(x.f.dep_icao || x.f.dep || x.r.dep || "")));
  const todo = targets.filter(x => {
        return targets.filter(y => y.f.callsign === x.f.callsign).length === 1;
  });
  if(!todo.length){ if(quiet) return; alert(rows.length ? "Không có chuyến cất cánh từ Việt Nam để check ATC (hoặc chuyến trùng số hiệu)." : "Bảng chưa có chuyến — bấm Cmp trước."); return; }
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
    const timeout = setTimeout(() => { stream.close(); fail("AviWeb chưa trả kết quả — bấm ATC check để thử lại"); }, 120000);
    stream.onmessage = event => {
      let m; try { m = JSON.parse(event.data); } catch(_){ return; }
      if(m.type !== "end") return;
      clearTimeout(timeout); stream.close();
      for(const {f} of todo){
        const hits = (m.results || []).filter(result => String(result.callsign).toUpperCase() === f.callsign.toUpperCase());
        const result = hits.length === 1 ? hits[0] : null;
        const status = result ? cmpAtcStatus(result, f.callsign, acDofFromStd(f.std)) : "";
        cmpAtcPut(f, status, status ? "" : (result && result.error) || "Chưa có trạng thái đúng ngày/chặng trên AviWeb", status && result ? result.reg : "", status && result ? result.flight_time : "", result ? result.dof : "");
      }
      finish();
    };
    stream.onerror = () => { clearTimeout(timeout); stream.close(); fail("Không kết nối được AviWeb — bấm ATC check để thử lại"); };
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
  const fplRow = f && typeof cmpSyncSources !== "undefined" ? cmpSourceChange(cmpSyncSources.fpl || [], f.id, f.std) : null;
  const excelReg = fplRow && fplRow.reg && String(fplRow.reg.new || "").trim();
  const reg = excelReg || (f && cached && cached.stamp === ofpStamp(f) ? cached.reg : "");
  const changes = ((typeof vLast !== "undefined" && vLast && vLast.rows) || []).filter(v =>
    String(v.sector_id) === String(r.sector_id) && v.reg && v.reg.changed
    && v.ops_ok !== false && v.fb_std && f && new Date(v.fb_std).getTime() === new Date(f.std).getTime());
  const bound = cmpBind[String(r.sector_id)];
  const aims = ((bound && bound.reg) || r.reg_cmp || {}).excel;
  // Crewlist/FPL diffs prove an aircraft change even after the OFP already carries the new REG.
  const srcChg = !!f && typeof cmpSyncSources !== "undefined" && typeof cmpAircraftChange === "function"
    && [cmpSyncSources.crew || [], cmpSyncSources.fpl || []].some(list => { const x = cmpSourceChange(list, f.id, f.std); return !!(x && cmpAircraftChange(x.reg)); });
  const state = cmpRegState(reg, f && f.reg, aims, changes.length === 1 || srcChg);
  td.textContent = reg || "—";
  td.classList.toggle("cmp-fpl-match", state.same);
  td.classList.toggle("cmp-fpl-mismatch", !!reg && !!f && !state.same);
  td.title = (excelReg ? "Excel FPL mới: " : "FPL: ") + (reg || "chưa đọc được") + "\\nFliteBrief: " + ((f && f.reg) || "—");
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
    else if(k === "tow" || k === "lwt"){
      if(c.querySelector(".vd.bad")) level = "bad";
      else if(c.querySelector(".warn,.pcr-near,.pcr-hot,.crit")) level = "warn";
    }
    else if(c.querySelector(".bad,.crit,.pcr-hot,.fuel-tight")) level = "bad";
    else if(c.querySelector(".warn,.pcr-near")) level = "warn";
    items.push({label, level, text: (c && (c.title || c.getAttribute("data-tip"))) || t});
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
    const parts = String(i.text).split("\\n");
    let first = parts[0];
    if(!first.toUpperCase().startsWith(i.label.split("/")[0])) first = i.label + ": " + first;
    const room = /còn\\s+(-?[\\d,]+)/.exec(parts.slice(0, 3).join(" "));
    line.textContent = first + (room ? " · còn " + room[1] : "");
    td.appendChild(line);
  }
  td.removeAttribute("title");
  const escV = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const tagTxt = {ok:"OK", warn:"Tiệm cận", bad:"Sai", pending:"Chưa có"};
  td.dataset.ctipW = "1";
  const symbols = {FUEL:"⛽",TOW:"↗",LWT:"↘",ZFW:"⚖","CONT/ERA":"⛨",ETP:"⌖"};
  td.dataset.ctip = '<div class="cmp-validation-flight">' + escV(td.dataset.cmpValCallsign || "") + '</div><div class="cmp-tip-h">Validation</div><div class="cmp-vs-grid">' + items.map((i, index) => {
    const lines = String(i.text || "").split("\\n").map(x => x.trim()).filter(Boolean);
    return '<div class="cmp-vs metric-' + index + ' ' + i.level + '"><div class="cmp-vs-h"><span><b class="cmp-vs-icon" aria-hidden="true">' + symbols[i.label] + '</b>' + escV(i.label) + '</span><em>' + tagTxt[i.level] + '</em></div>'
      + lines.map(l => '<div class="cmp-vs-l">' + escV(l).replace(/(còn\\s+-?[\\d,]+\\s*kg?)/i, "<b>$1</b>") + '</div>').join("") + '</div>';
  }).join("") + '</div>';
  cmpTipEnsure();
}
function renderCompareTable(d, opts){`)
    .replace('  fillWeights(rows, !!opts.refreshWeights);', '  cmpOpsRepaint(rows);\n  rows.forEach(cmpAtcPaint);\n  cmpReadFplRegs(rows);\n  setTimeout(() => cmpAtcAutoRun(rows), 0);\n  fillWeights(rows, !!opts.refreshWeights);')
    .replace('    if(changed) render();\n  }catch(_){}\n}\nasync function loadFlights', '    cmpOpsRepaint();\n    if(changed) render();\n  }catch(_){}\n}\nasync function loadFlights')
    .replace('  vLast = d;', '  vLast = d;\n  cmpRegRepaint();')
    .replace('    xls = d;\n', '    xls = d;\n    cmpAtcAutoPending = true;\n')
    .replace('  fplVerApplied = {old: $("#vOld").value, new: $("#vNew").value};', '  fplVerApplied = {old: $("#vOld").value, new: $("#vNew").value};\n  cmpAtcAutoPending = true;\n  if(lastCmp && lastCmp.table) cmpAtcAutoRun(lastCmp.table);')
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
      if(k === "val") td.dataset.cmpValCallsign = r.callsign;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`)
    .replace('  paintDelta(sid);\n}\n\n/* EST (Omni)', '  paintDelta(sid);\n  cmpValPaint(sid);\n}\n\n/* EST (Omni)')
    .replace('<span class="dim xls-bar-name crew-using" id="cmpVerBar"', '<button id="cmpAtcBtn" type="button" class="btn" onclick="cmpReadAtc((lastCmp && lastCmp.table) || [])" title="Đọc trạng thái ATC trên AviWeb cho các chuyến trong bảng">ATC check</button> <span class="dim xls-bar-name crew-using" id="cmpVerBar"')
    .replace('<button id="cmpAtcBtn"', '<button id="cmpHoBtn" type="button" class="btn" onclick="cmpToHandover()" title="Tạo bảng giao ca từ các chuyến của DSP trong bảng So sánh (kèm NOTE)">Giao ca</button> <button id="cmpAtcBtn"')
    .replace('function renderCompareTable(d, opts){', `function cmpHoClose(){
  const w = $("#wrapHandover"); if(w){ w.classList.remove("ho-pop"); w.style.display = "none"; }
  const b = $("#hoPopBack"); if(b) b.style.display = "none";
}
function cmpToHandover(){
  const all = (lastCmp && lastCmp.table) || [];
  if(!all.length){ alert("Bảng So sánh chưa có chuyến — bấm Cmp trước."); return; }
  const names = [...new Set(all.map(r => String(r.dsp || "").trim()).filter(Boolean))];
  let name = ($("#fDispatcher") && $("#fDispatcher").value) || "";
  if(!name){
    const pick = prompt("Chọn người giao ca (gõ số):\\n" + names.map((n,i) => (i+1) + ". " + n).join("\\n"), "1");
    if(pick == null) return;
    name = names[Number(pick) - 1] || names.find(n => dspKey(n) === dspKey(pick)) || "";
    if(!name){ alert("Không thấy DSP đó trong bảng So sánh."); return; }
  }
  const rows = all.filter(r => dspKey(r.dsp || "") === dspKey(name));
  if(!rows.length){ alert("DSP " + name + " không có chuyến trong bảng So sánh."); return; }
  const out = rows.map(r => {
    const f = cmpActionFlight(r) || {callsign: r.callsign, std: "", sta: "", dep: r.dep, dest: r.arr, reg: r.reg};
    const row = hoFromFlight(f, {});
    const tr = (document.querySelector('#cmpBody td[data-sid="' + r.sector_id + '"]') || {}).closest ? document.querySelector('#cmpBody td[data-sid="' + r.sector_id + '"]').closest("tr") : null;
    const note = tr && tr.querySelector(".cmp-note-input");
    row.note = (note && note.value.trim()) || "";
    const regTd = document.querySelector('#cmpBody td[data-fpl-reg-sid="' + r.sector_id + '"]');
    const reg = regTd && (regTd.textContent.match(/[A-Z]{2,3}-?[A-Z0-9]{3,5}/) || [])[0];
    if(reg) row.ac = reg.replace("-", "");
    const pld = tr && tr.querySelector('td[data-w="pld"]');
    const pt = pld && pld.textContent.trim();
    if(!row.payload && pt && /\\d/.test(pt)) row.payload = pt;
    if(!row.std && r.std) row.std = String(r.std).slice(-5).replace(":", "") + "Z";
    if(!row.sta && r.sta) row.sta = String(r.sta).replace(":", "") + "Z";
    return row;
  }).sort((a,b) => String(a.std).localeCompare(String(b.std)));
  const wrap = $("#wrapHandover");
  if(!$("#hoPopBack")){
    const back = document.createElement("div"); back.id = "hoPopBack";
    back.onclick = cmpHoClose; document.body.appendChild(back);
    const x = document.createElement("button"); x.type = "button"; x.id = "hoPopClose";
    x.className = "btn small"; x.textContent = "✕ Đóng"; x.onclick = cmpHoClose;
    const bar = wrap.querySelector(".ho-bar"); if(bar) bar.appendChild(x);
  }
  document.body.appendChild(wrap);
  wrap.classList.add("ho-pop"); wrap.style.display = "flex";
  $("#hoPopBack").style.display = "block";
  Promise.resolve(hoShow()).then(() => {
    hoFillDspList();
    if($("#hoDsp")) $("#hoDsp").value = name;
    if($("#hoFrom")) $("#hoFrom").value = name;
    const tb = $("#hoBody"); tb.innerHTML = "";
    out.forEach(hoAddRow);
    while(tb.children.length < Math.max(HO_BLANK, out.length + 3)) hoAddRow({});
    hoSay(out.length + " chuyến lấy từ bảng So sánh");
    hoSyncAllColTicks(); hoPaintMeta(); hoMarkDirty();
  });
}
function renderCompareTable(d, opts){`)
    .replace('</head>', `<style>
.cmptbl :is(th,td):nth-child(12),.cmptbl :is(th,td):nth-child(n+16):nth-child(-n+20){display:none!important}
.mode#mHandover{display:none!important}
#wrapHandover.ho-pop{position:fixed;inset:3vh 2vw;z-index:10001;border-radius:12px;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.45)}
#hoPopBack{display:none;position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55)}
#hoPopClose{display:none}#wrapHandover.ho-pop #hoPopClose{display:inline-flex}
.cmptbl .cmp-ops-status{margin-top:4px;text-align:left}
.cmptbl .cmp-vst{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:800;white-space:nowrap}
.cmptbl .cmp-vst.ok{background:#16a34a;color:#fff}
.cmptbl .cmp-vst.wait{background:#f59e0b;color:#fff}
.cmptbl .cmp-vst.none{background:#e5e7eb;color:#6b7280}
.cmptbl .cmp-vic{margin-left:4px;font-size:14px;vertical-align:middle}
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
.cmp-tip{position:fixed;z-index:9999;width:230px;padding:10px 12px;border-radius:12px;background:#0f172a;color:#e2e8f0;box-shadow:0 12px 32px rgba(15,23,42,.35);font-size:12px;pointer-events:none;opacity:0;transform:translateY(-4px);transition:opacity .12s,transform .12s}
.cmp-tip.on{opacity:1;transform:none}
.cmp-tip.cmp-tip-validation{box-sizing:border-box;width:580px;padding:16px;border:1px solid var(--validation-line);border-radius:8px;background:var(--validation-paper);color:var(--validation-ink);box-shadow:var(--validation-shadow);font-size:16px;line-height:1.5;letter-spacing:0;pointer-events:auto;overflow:auto}
.cmp-tip-validation .cmp-tip-h{font-size:18px;letter-spacing:0;color:var(--validation-ink);margin-bottom:12px;text-transform:none}
.cmp-validation-flight{font-size:23px;line-height:1.3;font-weight:800;color:var(--validation-ink);margin-bottom:3px}
.cmp-vs-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cmp-vs{--metric:var(--validation-fuel);padding:12px;border:1px solid var(--validation-line);border-left:4px solid var(--metric);border-radius:6px;background:color-mix(in oklab,var(--metric) 5%,var(--validation-paper));min-width:0}
.cmp-vs.metric-1{--metric:var(--validation-tow)}.cmp-vs.metric-2{--metric:var(--validation-lwt)}.cmp-vs.metric-3{--metric:var(--validation-zfw)}.cmp-vs.metric-4{--metric:var(--validation-era)}.cmp-vs.metric-5{--metric:var(--validation-etp)}
.cmp-vs-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;font-weight:800;font-size:17px;color:var(--metric);flex-wrap:wrap}
.cmp-vs-h>span{display:inline-flex;align-items:center;gap:7px}
.cmp-vs-icon{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:6px;background:color-mix(in oklab,var(--metric) 12%,var(--validation-paper));font-size:21px}
.cmp-vs-h em{font-style:normal;font-size:12px;line-height:1.4;padding:3px 7px;border-radius:999px;white-space:nowrap;background:var(--validation-line);color:var(--validation-ink)}
.cmp-vs.ok em{background:var(--validation-good);color:var(--validation-on-good)}.cmp-vs.warn em{background:var(--validation-warn);color:var(--validation-warn-ink)}.cmp-vs.bad em{background:var(--validation-bad);color:var(--validation-on-good)}
.cmp-vs-l{color:var(--validation-ink);overflow-wrap:anywhere;margin-top:3px;font-weight:500}.cmp-vs-l b{display:inline-block;font-weight:800;color:var(--metric)}
.cmp-vs.ok{--status-bg:var(--validation-good);--status-ink:var(--validation-on-good)}
.cmp-vs.warn{--status-bg:var(--validation-warn);--status-ink:var(--validation-warn-ink)}
.cmp-vs.bad{--status-bg:var(--validation-bad);--status-ink:var(--validation-on-good)}
.cmp-vs:is(.ok,.warn,.bad){background:var(--status-bg);border-color:var(--status-bg);color:var(--status-ink)}
.cmp-vs:is(.ok,.warn,.bad) :is(.cmp-vs-h,.cmp-vs-l,.cmp-vs-l b){color:var(--status-ink);-webkit-text-fill-color:var(--status-ink)}
.cmp-vs:is(.ok,.warn,.bad) .cmp-vs-icon{background:color-mix(in oklab,var(--status-ink) 16%,transparent);color:var(--status-ink)}
.cmp-vs:is(.ok,.warn,.bad) .cmp-vs-h em{background:color-mix(in oklab,var(--status-ink) 16%,transparent);color:var(--status-ink)}
@media(max-width:600px){.cmp-vs-grid{grid-template-columns:minmax(0,1fr)}.cmp-tip.cmp-tip-validation{width:380px}}
.cmp-tip-h{font-weight:800;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px}
.cmp-tip-row{display:flex;justify-content:space-between;align-items:center;padding:4px 8px;margin:3px 0;border-radius:8px;border-left:3px solid}
.cmp-tip-row .k{color:#cbd5e1}.cmp-tip-row b{font-family:monospace;font-size:13px;color:#fff}.cmp-tip-row b.diff{color:#fca5a5}
.cmp-tip-row.s-fb{background:rgba(59,130,246,.15);border-color:#3b82f6}
.cmp-tip-row.s-av{background:rgba(168,85,247,.15);border-color:#a855f7}
.cmp-tip-row.s-tm{background:rgba(148,163,184,.12);border-color:#64748b}
.cmp-tip-row.s-cl{background:rgba(249,115,22,.15);border-color:#f97316}
.cmp-tip-f{margin-top:6px;font-size:11px;color:#86efac}.cmp-tip-f.bad{color:#fca5a5;font-weight:700}
.cmp-atc-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.cmp-atc-pill.t-ok{background:#16a34a;color:#fff;border-color:#16a34a;font-weight:700}
html.night .cmp-atc-pill.t-ok{background:rgba(134,239,172,.18);color:#8ee4b0;border-color:rgba(134,239,172,.45)}
.cmp-atc-pill.t-air{background:#dbeafe;color:#1d4ed8;border-color:#93c5fd}
.cmp-atc-pill.t-done{background:#f1f5f9;color:#475569;border-color:#cbd5e1}
.cmp-atc-pill.t-warn{background:#fef3c7;color:#b45309;border-color:#fcd34d}
.cmp-atc-pill.t-bad{background:#fee2e2;color:#b91c1c;border-color:#fca5a5}
.cmp-atc-pill.t-info{background:#ede9fe;color:#6d28d9;border-color:#c4b5fd}
.cmp-atc-pill.t-none{background:transparent;color:#94a3b8;border-color:#e2e8f0;border-style:dashed}
.cmp-atc-pill.t-none::before{display:none}
.cmptbl .briefbtn:disabled{opacity:.35;cursor:not-allowed}
</style></head>`));
}
