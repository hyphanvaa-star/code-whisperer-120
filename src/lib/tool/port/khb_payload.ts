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

/** UTC day (YYYYMMDD) from the KHB local date + local ETD and the ETD UTC column (same instant). */
export function khbUtcDay(date: unknown, etdLocal: unknown, etdUtc: unknown): string {
  const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/.exec(String(date || '').trim());
  const clock = (v: unknown) => { const m = /^(\d{1,2}):?(\d{2})$/.exec(String(v || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const lt = clock(etdLocal), ut = clock(etdUtc);
  if (!d || lt == null || ut == null) return '';
  let off = lt - ut;
  while (off > 14 * 60) off -= 1440;
  while (off < -12 * 60) off += 1440;
  const y = d[3]!.length === 2 ? 2000 + Number(d[3]) : Number(d[3]);
  const t = new Date(Date.UTC(y, Number(d[2]) - 1, Number(d[1]), 0, lt - off));
  return t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, '0') + String(t.getUTCDate()).padStart(2, '0');
}

export function validationResult(alerts: string[], pending: string[]) {
  if (alerts.length) return { status: 'warning', text: [...new Set(alerts)].join(' · ') };
  if (pending.length) return { status: 'pending', text: 'Chưa đủ dữ liệu: ' + [...new Set(pending)].join(', ') };
  return { status: 'good', text: 'Good' };
}

/** A partial background comparison must not replace a completed verdict. */
export function stableValidation<T extends { s: string; t: string; h: string }>(previous: T | undefined, next: T, complete: boolean): T {
  return !complete && previous && (previous.s === 'good' || previous.s === 'warning') ? previous : next;
}

export function patchKhbPayloadPage(html: string): string {
  return html
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 3.04')
    .replace(/(#wrapFplText \.fttbl (?:th|td):nth-child\()(\d+)(\))/g, (match, before: string, index: string, after: string) => Number(index) >= 16 ? before + (Number(index) + 1) + after : match)
    .replace('width:1760px;min-width:100%', 'width:2640px;min-width:100%')
    .replace('<th>ETP POA</th><th>FL</th>', '<th>Validation</th><th class="ft-pld-head" title="EST PLD Omni (kg)">PLD</th><th>FL</th>')
    .replace('blank.appendChild(ftBox(pending, "etp_poa", true));', 'blank.appendChild(ftValidationCell(null));\n      blank.appendChild(ftPldCell(null));')
    .replace('tr.appendChild(ftBox(st, "etp_poa", true));', 'tr.appendChild(ftValidationCell(f));\n    tr.appendChild(ftPldCell(f));')
    .replace('if(ftPldOn && st.pay) items[items.length - 1].pay = st.pay;', 'if(st.pay != null && String(st.pay).trim() !== "") items[items.length - 1].pay = st.pay;')
    .replace('<button type="button" class="btn small" id="ftPldRound"', '<button type="button" class="btn small" id="ftEstLoad" title="Lấy EST Omni cho các chuyến đã tick">↓ EST Omni</button><button type="button" class="btn small" id="ftPldRound"')
    .replace('      st.pay = String(row.pay);', '      st.est = row.est == null ? st.est : String(row.est);\n      st.pay = String(row.pay);')
    .replace('function ftRender(){', `
const ftPayloadPair = ${payloadPair.toString()};
const ftKhbUtcDay = ${khbUtcDay.toString()};
const ftOfpPending = new Set();
function ftPayloadSector(f, requireReg = true){
  const st = ftSt(f);
  const local = /^(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2}|\\d{4})\\b/.exec(String(st.date || "").trim());
  const iso = /^(\\d{4})-(\\d{2})-(\\d{2})/.exec(String(st.date || "").trim());
  let day = "";
  if(iso) day = iso[1] + iso[2] + iso[3];
  else if(local) day = (local[3].length === 2 ? "20" + local[3] : local[3]) + local[2].padStart(2,"0") + local[1].padStart(2,"0");
  if(!day || !st.dep || !st.arr) return null;
  const shifted = (std, h) => {
    const t = new Date(std).getTime();
    if(!Number.isFinite(t)) return "";
    const d = new Date(t + h * 3600000);
    return d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2,"0") + String(d.getUTCDate()).padStart(2,"0");
  };
  const regKey = r => ftRegKey(r).replace(/^VN/, "");
  const base = (allFlights || []).filter(g => ftDigits(g.callsign || g.fltno) === ftDigits(f.flt)
    && ftAptHit(st.dep, g.dep_icao || g.dep_iata || g.dep)
    && ftAptHit(st.arr, g.dest_icao || g.dest_iata || g.arr || g.dest)
    && (!requireReg || !st.reg || !g.reg || regKey(st.reg) === regKey(g.reg))
    && inOpsWindow(g));
  // Ngày KHB là giờ địa phương sân bay đi; tự tính ngày UTC từ ETD + ETD UTC rồi so với STD UTC của CFP.
  const utcDay = ftKhbUtcDay(st.date, st.etd || f.std, st.utc || f.utc);
  if(utcDay){
    const hit = base.filter(g => shifted(g.std, 0) === utcDay);
    return hit.length === 1 ? hit[0] : null;
  }
  const vn = base.filter(g => shifted(g.std, 7) === day);
  if(vn.length) return vn.length === 1 ? vn[0] : null;
  const utc = base.filter(g => shifted(g.std, 0) === day);
  return utc.length === 1 ? utc[0] : null;
}
function ftPldCell(f){
  const td = document.createElement("td");
  td.className = "ft-pld-cell";
  const value = document.createElement("div");
  value.className = "ft-pld-value ft-pld-grid";
  value.title = "EST PLD Omni (kg)";
  const estEl = document.createElement("span");
  value.append(estEl);
  td.appendChild(value);
  const paint = (pld, est) => {
    const [a, b] = ftPayloadPair(pld, est).split(" / ");
    estEl.textContent = b === "—" ? b : Number(b).toLocaleString("en-US");
    estEl.dataset.empty = String(b === "—");
    estEl.className = ""; value.title = "EST PLD Omni (kg)";
    if(a !== "—" && b !== "—"){
      const v = Number(a) - Number(b), hi = Math.abs(v) > 2000;
      estEl.className = (v > 0 ? "ft-pld-ok" : v < 0 ? "ft-pld-bad" : "") + (hi ? " ft-pld-hi" : "");
    }
  };
  if(!f){ paint(null,null); return td; }
  ftEstAutoLater();
  const st = ftSt(f), identity = ftEstIdentity(f), sector = ftPayloadSector(f);
  const update = w => { paint(w && w.pld, st.est); };
  td._repaint = () => { const s2 = ftPayloadSector(f); const w = s2 && W_CACHE[s2.id]; update(w && ofpFitsFlight(s2,w) ? w : null); };
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
      }).catch(() => { value.title = "EST PLD Omni (kg)"; })
      .finally(() => ftOfpPending.delete(sector.id));
  }
  return td;
}
let ftEstBusy = false;
function ftEstIdentity(f){
  const st = ftSt(f);
  return JSON.stringify([f.flt, st.date, st.dep, st.arr, f.std, st.etd]);
}
const ftEstAutoDone = new Set();
let ftEstAutoTimer;
function ftEstAutoLater(){
  clearTimeout(ftEstAutoTimer);
  ftEstAutoTimer = setTimeout(() => {
    if(ftEstBusy) return ftEstAutoLater();
    const todo = (ftRows || []).filter(f => f && !ftSt(f).est && !ftEstAutoDone.has(ftEstIdentity(f)));
    if(!todo.length) return;
    todo.forEach(f => ftEstAutoDone.add(ftEstIdentity(f)));
    ftLoadEst(todo, null, true);
  }, 1500);
}
async function ftLoadEst(flights, btn, auto){
  if(ftEstBusy) return;
  btn = btn || {};
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
      snap.st.est = String(row.est);
      if(!auto){ snap.st.pay = String(row.est); snap.st.payManual = false; }
      count++;
    }
    if(auto){ for(const c of document.querySelectorAll("#ftBody .ft-pld-cell")) if(c._repaint) c._repaint(); }
    else ftRender();
    ftKeepSave();
    $("#ftStat").textContent = "Đã lấy EST Omni cho " + count + " chuyến" + (notes.length ? " · " + notes.join(" · ") : "");
    if(notes.length && !auto) alert(notes.join("\\n"));
  }catch(err){ $("#ftStat").textContent = "EST Omni: " + err.message; if(!auto) alert("EST Omni: " + err.message); }
  finally{ ftEstBusy = false; btn.disabled = false; }
}
$("#ftEstLoad").onclick = function(){ ftLoadEst(ftRows.filter(f => f && ftSt(f).on), this); };
// EST Omni: tự lấy lại lặng lẽ mỗi 5 phút cho các chuyến trên bảng.
setInterval(() => {
  if(ftEstBusy || document.hidden) return;
  const rows = (ftRows || []).filter(f => f && ftPayloadSector(f));
  if(rows.length) ftLoadEst(rows, null, true);
}, 5 * 60 * 1000);
// OFP: kiểm tra mỗi 20 giây; chỉ cập nhật ô khi số CFP (hoặc payload) đổi.
let ftOfpWatchBusy = false;
setInterval(async () => {
  if(ftOfpWatchBusy || document.hidden) return;
  const ids = [...new Set((ftRows || []).map(f => f && ftPayloadSector(f)).filter(Boolean).map(s => s.id))];
  if(!ids.length) return;
  ftOfpWatchBusy = true;
  try{
    const d = await (await fetch("/api/weights?days=" + DAYS + "&ids=" + ids.join(","))).json();
    let changed = false;
    for(const id of ids){
      const w = (d.weights || {})[String(id)], old = W_CACHE[id];
      if(!w) continue;
      if(!old || String(old.plan_no || "") !== String(w.plan_no || "") || old.pld !== w.pld){ W_CACHE[id] = w; changed = true; }
    }
    if(changed){ for(const c of document.querySelectorAll("#ftBody .ft-pld-cell")) if(c._repaint) c._repaint(); }
  }catch(_){}
  finally{ ftOfpWatchBusy = false; }
}, 20000);
function ftRender(){`);
}