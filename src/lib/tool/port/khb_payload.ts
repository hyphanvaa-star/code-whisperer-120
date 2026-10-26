import { omniPayload } from './fpl_payload';
import type { Raw } from './fpl_tool';

/** Explicit EST download: no rounding, uplift or invented missing value. */
export function rawOmniPay(rows: Raw[], flight: Raw): string | null {
  const est = omniPayload(rows, flight);
  return est === null ? null : String(est);
}

export function patchKhbPayloadPage(html: string): string {
  return html
    .replace(/(#wrapFplText \.fttbl (?:th|td):nth-child\()(\d+)(\))/g, (match, before: string, index: string, after: string) => Number(index) >= 16 ? before + (Number(index) + 1) + after : match)
    .replace('width:1760px;min-width:100%', 'width:1870px;min-width:100%')
    .replace('<th>ETP POA</th><th>FL</th>', '<th>Validation</th><th>PLD</th><th>FL</th>')
    .replace('blank.appendChild(ftBox(pending, "etp_poa", true));', 'blank.appendChild(ftBox(pending, "etp_poa", true));\n      blank.appendChild(ftBox(pending, "pay", false));')
    .replace('tr.appendChild(ftBox(st, "etp_poa", true));', 'tr.appendChild(ftBox(st, "etp_poa", true));\n    tr.appendChild(ftPldCell(f));')
    .replace('if(ftPldOn && st.pay) items[items.length - 1].pay = st.pay;', 'if(st.pay != null && String(st.pay).trim() !== "") items[items.length - 1].pay = st.pay;')
    .replace('<button type="button" class="btn small" id="ftPldRound"', '<button type="button" class="btn small" id="ftEstLoad" title="Lấy EST Omni cho các chuyến đã tick">↓ EST Omni</button><button type="button" class="btn small" id="ftPldRound"')
    .replace('function ftRender(){', `
function ftPldCell(f){
  const st = ftSt(f);
  const td = ftBox(st, "pay", false);
  td.className = "ft-pld-cell";
  const input = td.querySelector("input");
  if(input){ input.inputMode = "numeric"; input.setAttribute("aria-label", "PLD VJ" + f.flt); }
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
      snap.st.pay = String(row.est); snap.st.payManual = false; count++;
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