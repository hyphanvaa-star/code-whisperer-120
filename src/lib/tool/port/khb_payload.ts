import { omniPayload } from './fpl_payload';
import type { Raw } from './fpl_tool';

/** Explicit EST download: no rounding, uplift or invented missing value. */
export function rawOmniPay(rows: Raw[], flight: Raw): string | null {
  const est = omniPayload(rows, flight);
  return est === null ? null : String(est);
}

export function payloadPair(ofp: unknown, est: unknown): string {
  const value = (v: unknown) => v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? String(Number(v)) : '—';
  return value(ofp) + ' / ' + value(est);
}

export function validationResult(alerts: string[], pending: string[]) {
  if (alerts.length) return { status: 'warning', text: [...new Set(alerts)].join(' · ') };
  if (pending.length) return { status: 'pending', text: 'Chưa đủ dữ liệu: ' + [...new Set(pending)].join(', ') };
  return { status: 'good', text: 'Good' };
}

export function patchKhbPayloadPage(html: string): string {
  return html
    .replace(/(#wrapFplText \.fttbl (?:th|td):nth-child\()(\d+)(\))/g, (match, before: string, index: string, after: string) => Number(index) >= 16 ? before + (Number(index) + 1) + after : match)
    .replace('width:1760px;min-width:100%', 'width:2640px;min-width:100%')
    .replace('<th>ETP POA</th><th>FL</th>', '<th>Validation</th><th>PLD</th><th>FL</th>')
    .replace('blank.appendChild(ftBox(pending, "etp_poa", true));', 'blank.appendChild(ftValidationCell(null));\n      blank.appendChild(ftPldCell(null));')
    .replace('tr.appendChild(ftBox(st, "etp_poa", true));', 'tr.appendChild(ftValidationCell(f));\n    tr.appendChild(ftPldCell(f));')
    .replace('if(ftPldOn && st.pay) items[items.length - 1].pay = st.pay;', 'if(st.pay != null && String(st.pay).trim() !== "") items[items.length - 1].pay = st.pay;')
    .replace('<button type="button" class="btn small" id="ftPldRound"', '<button type="button" class="btn small" id="ftEstLoad" title="Lấy EST Omni cho các chuyến đã tick">↓ EST Omni</button><button type="button" class="btn small" id="ftPldRound"')
    .replace('      st.pay = String(row.pay);', '      st.est = row.est == null ? st.est : String(row.est);\n      st.pay = String(row.pay);')
    .replace('function ftRender(){', `
const ftPayloadPair = ${payloadPair.toString()};
const ftValidationResult = ${validationResult.toString()};
let ftValidationTimer;
function ftValidationLater(){
  clearTimeout(ftValidationTimer);
  ftValidationTimer = setTimeout(ftValidationSync, 80);
}
function ftValidationCell(f){
  const td = document.createElement("td");
  td.className = "ft-validation-cell";
  td._flight = f;
  td.textContent = f ? "Chưa so sánh" : "—";
  ftValidationLater();
  return td;
}
function ftValidationSync(){
  for(const td of document.querySelectorAll("#ftBody .ft-validation-cell")){
    const f = td._flight;
    if(!f) continue;
    const sector = ftPayloadSector(f, false);
    const r = sector && cmpRowOf(sector.id);
    const marker = sector && document.querySelector('#cmpBody td[data-sid="' + sector.id + '"]');
    const tr = marker && marker.closest("tr");
    let result;
    const details = [];
    if(!r || !tr){ result = ftValidationResult([], ["So sánh đúng chuyến/ngày/chặng"]); }
    else {
      const alerts = [], pending = [];
      if(r.note){ alerts.push(r.note); details.push(r.note); }
      if(!r.in_excel) pending.push("Crewlist");
      const inspect = (cell, label, allowNil) => {
        if(!cell){ pending.push(label); return; }
        const warning = cell.querySelector(".bad,.warn,.crit,.pcr-hot,.pcr-near,.fuel-tight,.alt-blink,.delta-hi,.cmp-reg-bang");
        if(warning){ alerts.push(label + ": " + (cell.textContent.trim() || "cảnh báo")); details.push(label + ": " + (cell.title || cell.textContent)); }
        if(!warning && (!cell.textContent.trim() || /^[—….·]+$/.test(cell.textContent.trim())) && !(allowNil && (cell.textContent.trim() === "nil" || label === "ALT"))) pending.push(label);
        if(label === "FUEL" && /chưa/i.test(cell.title || "")) pending.push(label);
      };
      for(const [key,label] of [["crewSid","CREW"],["regSid","REG"]]){
        const cell = tr.querySelector('[data-' + (key === "crewSid" ? "crew-sid" : "reg-sid") + ']');
        inspect(cell,label,false);
        if(cell && !cell.querySelector(key === "crewSid" ? ".cmp-crew.ok,.cmp-crew.bad" : ".cmp-reg.ok,.cmp-reg.bad")) pending.push(label);
      }
      for(const [key,label] of [["fuel","FUEL"],["alt","ALT"],["pld","PLD"],["tow","TOW / MTOW"],["lwt","LWT / MLWT"],["ezfw","ZFW / MZFW"],["etp","ETP"],["rres","CONT FUEL / ERA"]]){
        inspect(tr.querySelector('[data-w="' + key + '"]'),label,key === "etp" || key === "alt");
      }
      if($("#cmpPld").checked){
        inspect(tr.querySelector('[data-w="est"]'),"EST",false);
        inspect(tr.querySelector('[data-w="delta"]'),"Δ EST–PLD",false);
      }else pending.push("PLD / EST chưa bật");
      const w = W_CACHE[sector.id];
      if(!w || !ofpFitsFlight(sector,w)) pending.push("OFP hiện tại");
      result = ftValidationResult(alerts,pending);
    }
    td.dataset.status = result.status;
    td.textContent = result.text;
    td.title = details.length ? details.join("\\n\\n") : result.text;
  }
}
new MutationObserver(ftValidationLater).observe($("#cmpBody"), {childList:true,subtree:true,attributes:true,characterData:true});
const ftOfpPending = new Set();
function ftPayloadSector(f, requireReg = true){
  const st = ftSt(f);
  const dateKey = value => {
    const s = String(value || "");
    const iso = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(s);
    if(iso) return iso[1] + iso[2] + iso[3];
    const local = /^(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4})/.exec(s);
    return local ? local[3] + local[2].padStart(2,"0") + local[1].padStart(2,"0") : "";
  };
  const day = dateKey(st.date);
  if(!day || !st.dep || !st.arr) return null;
  const hits = (allFlights || []).filter(g => ftDigits(g.callsign || g.fltno) === ftDigits(f.flt)
    && dateKey(g.std) === day && ftAptHit(st.dep, g.dep_icao || g.dep)
    && ftAptHit(st.arr, g.dest_icao || g.arr || g.dest)
    && (!requireReg || ftRegKey(st.reg) === ftRegKey(g.reg))
    && inOpsWindow(g));
  return hits.length === 1 ? hits[0] : null;
}
function ftPldCell(f){
  const td = document.createElement("td");
  td.className = "ft-pld-cell";
  const value = document.createElement("span");
  value.className = "ft-pld-value";
  value.title = "Payload OFP / EST Omni (kg)";
  td.appendChild(value);
  if(!f){ value.textContent = ftPayloadPair(null,null); return td; }
  const st = ftSt(f), identity = ftEstIdentity(f), sector = ftPayloadSector(f);
  const update = w => { value.textContent = ftPayloadPair(w && w.pld, st.est); };
  const cached = sector && W_CACHE[sector.id];
  update(cached && ofpFitsFlight(sector,cached) ? cached : null);
  if(sector && !cached && !ftOfpPending.has(sector.id)){
    ftOfpPending.add(sector.id);
    fetch("/api/weights?days=" + DAYS + "&ids=" + sector.id + "&cache=1")
      .then(r => { if(!r.ok) throw new Error("Không lấy được payload OFP"); return r.json(); })
      .then(d => {
        const w = (d.weights || {})[String(sector.id)];
        if(!w || !ofpFitsFlight(sector,w)) return;
        W_CACHE[sector.id] = w;
        if(td.isConnected && ftRows.includes(f) && ftEstIdentity(f) === identity) update(w);
      }).catch(() => { value.title = "Chưa lấy được payload OFP / EST Omni (kg)"; })
      .finally(() => ftOfpPending.delete(sector.id));
  }
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "btn small ft-est-arrow";
  btn.textContent = "↓"; btn.title = "Lấy EST Omni · VJ" + f.flt;
  btn.setAttribute("aria-label", btn.title);
  btn.onclick = () => ftLoadEst([f], btn);
  td.appendChild(btn);
  return td;
}
let ftEstBusy = false;
function ftEstIdentity(f){
  const st = ftSt(f);
  return JSON.stringify([f.flt, st.date, st.dep, st.arr, f.std, st.etd]);
}
async function ftLoadEst(flights, btn){
  if(ftEstBusy) return;
  if(!flights.length){ alert("Chưa tick chuyến nào để lấy EST Omni."); return; }
  const snapshots = flights.map(f => ({f, st:ftSt(f), identity:ftEstIdentity(f), pay:ftSt(f).pay}));
  const specs = snapshots.map(({f, st}) => ({id:f.id, flt:f.flt, date:st.date, dep:st.dep, arr:st.arr, std:f.std, etd:st.etd}));
  ftEstBusy = true; btn.disabled = true;
  $("#ftStat").textContent = "Đang lấy EST Omni…";
  try{
    let refreshed = await (await fetch("/api/est/refresh")).json();
    if(refreshed.error && omniNeedsBrowser(refreshed.error) && await omniBrowserLogin()){
      refreshed = await (await fetch("/api/est/refresh")).json();
    }
    if(refreshed.error) throw new Error(refreshed.error);
    const response = await fetch("/api/fpltext/pld", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({rows:specs, mode:"est"})});
    const d = await response.json();
    if(!response.ok || d.error) throw new Error(d.error || "Không lấy được EST Omni");
    const notes = []; let count = 0;
    for(const snap of snapshots){
      if(!ftRows.includes(snap.f) || ftSt(snap.f) !== snap.st || ftEstIdentity(snap.f) !== snap.identity || snap.st.pay !== snap.pay){
        notes.push("VJ" + snap.f.flt + ": đã đổi dữ liệu trong lúc tải; giữ ô PLD hiện tại."); continue;
      }
      const row = (d.rows || []).find(r => String(r.id) === String(snap.f.id));
      if(!row || row.est == null || !Number.isFinite(Number(row.est)) || Number(row.est) <= 0){ notes.push((row && row.alert) || "VJ" + snap.f.flt + ": không có EST đúng ngày/chặng; giữ PLD hiện tại."); continue; }
      snap.st.est = String(row.est); snap.st.pay = String(row.est); snap.st.payManual = false; count++;
    }
    ftRender(); ftKeepSave();
    $("#ftStat").textContent = "Đã lấy EST Omni cho " + count + " chuyến" + (notes.length ? " · " + notes.join(" · ") : "");
    if(notes.length) alert(notes.join("\\n"));
  }catch(err){ $("#ftStat").textContent = "EST Omni: " + err.message; alert("EST Omni: " + err.message); }
  finally{ ftEstBusy = false; btn.disabled = false; }
}
$("#ftEstLoad").onclick = function(){ ftLoadEst(ftRows.filter(f => f && ftSt(f).on), this); };
function ftRender(){`);
}