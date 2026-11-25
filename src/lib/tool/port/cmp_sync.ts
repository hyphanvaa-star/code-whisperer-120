import { cmpCrewPair } from './revision_baseline';

type ChangeRow = { sector_id?: unknown; fb_std?: unknown; ops_ok?: boolean; reg?: { changed?: boolean; old?: unknown; new?: unknown }; crew?: { changed?: boolean; raw_old?: unknown; raw_new?: unknown; out?: string[]; in?: string[] } };

/** A source change must identify this exact operational sector and instant. */
export function cmpSourceChange(rows: ChangeRow[], id: unknown, std: unknown): ChangeRow | null {
  const time = new Date(String(std || '')).getTime();
  if (!Number.isFinite(time)) return null;
  const same = rows.filter(r => String(r.sector_id) === String(id));
  const exact = same.filter(r => new Date(String(r.fb_std || '')).getTime() === time);
  if (exact.length === 1) return exact[0] ?? null;
  // A delay/CHG moves the FliteBrief STD after the diff was read; the sector ID stays the same.
  // Accept the single change row of this sector when it is still within 24 h of the live STD.
  const near = same.filter(r => Math.abs(new Date(String(r.fb_std || '')).getTime() - time) < 24 * 3600e3);
  return exact.length === 0 && near.length === 1 ? near[0] ?? null : null;
}

export function cmpAircraftChange(reg: ChangeRow['reg']): boolean {
  const norm = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return !!reg?.changed && !!norm(reg.old) && !!norm(reg.new) && norm(reg.old) !== norm(reg.new);
}

/** CHG turns green once FliteBrief carries the Crewlist aircraft (fresh OFP read or live Compare match). */
export function cmpChgFbReady(reg: { excel?: unknown; flite?: unknown } | null | undefined, newReg: unknown, freshRegOk: boolean): boolean {
  if (freshRegOk) return true;
  const norm = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const excel = norm(reg && reg.excel), flite = norm(reg && reg.flite);
  if (!excel || !flite || excel !== flite) return false;
  return !norm(newReg) || norm(newReg) === excel;
}

/** Pick the ATC message for a sector: DLA from the FPL diff plus any aircraft change becomes CHG DLA. */
export function cmpMsgKind(raw: unknown, acChg: boolean): string {
  const k = String(raw || '').toUpperCase().trim();
  if (k === 'CHG DLA') return 'CHG DLA';
  if (k === 'CHG') return 'CHG A/C';
  if (k === 'DLA') return acChg ? 'CHG DLA' : 'DLA';
  return acChg ? 'CHG A/C' : '';
}

/** AviWeb supports aircraft/equipment/EOBT changes, never routes, alternates or CNL. */
export function cmpAviOperation(kind: string): 'CHG' | 'DLA' | null {
  if (kind === 'DLA') return 'DLA';
  return ['CHG', 'CHG A/C', 'CHG DLA', 'CHG A/C AND DLA', 'CHG TIME'].includes(kind) ? 'CHG' : null;
}

/** Remember a live Crewlist≠FliteBrief aircraft change so CHG survives once the new CFP carries the Crewlist aircraft. */
export function cmpRegMemory(prev: { old: string; new: string } | null | undefined, live: { changed?: boolean; old?: unknown; new?: unknown } | null | undefined, reg: { verdict?: unknown; excel?: unknown } | null | undefined): { old: string; new: string } | null {
  const norm = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (live && live.changed && norm(live.old) && norm(live.new) && norm(live.old) !== norm(live.new)) return { old: String(live.old).trim(), new: String(live.new).trim() };
  if (!prev) return null;
  if (!reg || !reg.verdict || !norm(reg.excel)) return prev;
  return norm(reg.excel) === norm(prev.new) ? prev : null;
}

/** Crewlist ETD later than STD (local HH:MM, same day or past midnight) by at least 15 min → delay minutes, else 0. */
export function cmpCrewDelayMin(std: unknown, etd: unknown): number {
  const hm = (v: unknown) => { const m = /(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
  const a = hm(std), b = hm(etd);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const d = (b - a + 1440) % 1440;
  return d >= 15 && d <= 720 ? d : 0;
}

/** ATC delay kind: the FPL diff wins; otherwise a Crewlist delay (diff row or live STD→ETD) means DLA. */
export function cmpDelayKind(raw: unknown, crewDelay: { changed?: boolean } | null | undefined, crewStd: unknown, crewEtd: unknown): string {
  const k = String(raw || '').toUpperCase().trim();
  if (k) return k;
  return (crewDelay && crewDelay.changed) || cmpCrewDelayMin(crewStd, crewEtd) > 0 ? 'DLA' : '';
}

/** Aircraft-change memory is keyed by sector ID + callsign, so a delay that moves the FliteBrief STD keeps it.
 *  Older keys also carried the STD: accept one for the same sector within 24 h so existing memory survives. */
export function cmpRegMemFind(store: Record<string, { old: string; new: string } | undefined> | null | undefined, id: unknown, callsign: unknown, std: unknown): { key: string; value: { old: string; new: string } } | null {
  if (!store) return null;
  const key = JSON.stringify([id, callsign]);
  const own = store[key];
  if (own) return { key, value: own };
  const time = new Date(String(std || '')).getTime();
  const hits: { key: string; value: { old: string; new: string } }[] = [];
  for (const k of Object.keys(store)) {
    let a: unknown;
    try { a = JSON.parse(k); } catch { continue; }
    if (!Array.isArray(a) || a.length !== 3 || String(a[0]) !== String(id) || String(a[1]) !== String(callsign)) continue;
    const t = new Date(String(a[2] || '')).getTime();
    const value = store[k];
    if (value && Number.isFinite(t) && Number.isFinite(time) && Math.abs(t - time) < 24 * 3600e3) hits.push({ key: k, value });
  }
  return hits.length === 1 ? hits[0] ?? null : null;
}

/** Attached aircraft file names another tail than the Crewlist aircraft already on FliteBrief. */
export function cmpAttachMismatch(reg: { excel?: unknown; flite?: unknown } | null | undefined, atch: unknown): { changed: true; attach: true; old: string; new: string } | null {
  const norm = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const excel = norm(reg && reg.excel), flite = norm(reg && reg.flite);
  const code = String(atch || '').replace(/[^0-9]/g, '');
  const tail = (excel.match(/(\d{3})$/) || [])[1] || '';
  if (!tail || code.length !== 3 || code === tail) return null;
  if (flite && flite !== excel) return null;
  return { changed: true, attach: true, old: 'VN-A' + code, new: String(reg && reg.excel).trim() };
}

/** REQ is driven by Crewlist changes, not FPL revisions or sync acknowledgement. */
export function cmpReqChange(rows: ChangeRow[], id: unknown, std: unknown): ChangeRow | null {
  const row = cmpSourceChange(rows, id, std);
  return row && row.ops_ok !== false && (cmpAircraftChange(row.reg) || row.crew?.changed) ? row : null;
}

export function cmpReqKey(uid: string, f: { id: unknown; callsign: unknown; std: unknown; dep: unknown; arr: unknown }, row: ChangeRow): string {
  return JSON.stringify([uid, f.id, f.callsign, f.std, f.dep, f.arr, row.reg, row.crew]);
}

/** Only identifiable operating pilots authorize a crew write. */
export function cmpPilotChanges(oldRaw: unknown, newRaw: unknown) {
  const pilots = (raw: unknown) => {
    const out: Record<string, string> = {};
    const seen = new Set<string>();
    for (const m of String(raw || '').matchAll(/\(([^)]*)\)\s*-?\s*(\d{3,6})/g)) {
      const role = String(m[1] || '').toUpperCase();
      if (/DHD/.test(role)) continue;
      const key = /\b(CP|CPT|CAPT|CAPTAIN)\b/.test(role) ? 'cptText' : /\b(FO|F\/O|FIRST OFFICER)\b/.test(role) ? 'foText' : '';
      if (key) { out[key] = seen.has(key) ? '' : String(m[2] || '').replace(/^0+/, ''); seen.add(key); }
    }
    return out;
  };
  const old = pilots(oldRaw), next = pilots(newRaw);
  return ['cptText', 'foText'].filter(key => next[key] && old[key] !== next[key]).map(key => ({key, from: old[key] || '', to: next[key]}));
}

/** Pick distinct numeric revisions from one operating date, never upload order. */
export function cmpFplPair<T extends { name: string; modified?: number }>(files: T[], now = Date.now(), allowSingle = false): T[] {
  const reference = new Date(now);
  const year = reference.getUTCFullYear();
  const candidates = files.flatMap(file => {
    const ver = /\bVER\D{0,3}(\d+)/i.exec(file.name);
    const date = /(?:^|[^0-9])(\d{1,2})\s*[-_ ]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?![A-Z])(?:\s*[-_ ]?\s*(20\d{2}))?/i.exec(file.name);
    if (!ver || !date || !/FLIGHT\s*PLAN|\bFPL\b/i.test(file.name)) return [];
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
  return previous ? [previous.file, latest.file] : allowSingle ? [latest.file] : [];
}

/** Live mismatch fallback: Crewlist pilots absent on FliteBrief, paired with FliteBrief-only IDs when counts agree. */
export function cmpCellCrewChanges(excelRaw: unknown, detail: unknown) {
  const text = String(detail || '');
  const ids = (label: string) => ((text.split(label)[1] || '').split('·')[0] || '').split(/[^0-9]+/).filter(Boolean).map(v => v.replace(/^0+/, ''));
  const missing = ids('Excel có mà FliteBrief không:'), extra = ids('FliteBrief có mà Excel không:');
  const pilots: {key: string; id: string}[] = [];
  for (const m of String(excelRaw || '').matchAll(/\(([^)]*)\)\s*-?\s*(\d{3,6})/g)) {
    const role = String(m[1] || '').toUpperCase();
    if (/DHD/.test(role)) continue;
    const key = /\b(CP|CPT|CAPT|CAPTAIN)\b/.test(role) ? 'cptText' : /\b(FO|F\/O|FIRST OFFICER)\b/.test(role) ? 'foText' : '';
    const id = String(m[2] || '').replace(/^0+/, '');
    if (key && missing.includes(id) && !pilots.some(p => p.key === key)) pilots.push({key, id});
  }
  const pair = extra.length === pilots.length;
  return pilots.map((p, i) => ({key: p.key, from: pair ? extra[i] || '' : '', to: p.id}));
}

/** Plain-language result of a FliteBrief aircraft/crew swap job, built from its streamed log lines.
 *  Lists what was done and why each failed step failed, so a partial update is never reported as one vague error. */
export function cmpSwapReport(lines: Array<{ text?: unknown; cls?: unknown }>, ended: boolean): string {
  const done: string[] = [], bad: string[] = [];
  const name = (t: string) => t.replace(/\s+\(.*\)\s*$/, '').trim();
  for (const l of lines) {
    const t = String((l && l.text) || '').trim();
    let m: RegExpExecArray | null;
    if ((m = /^✓ đã xoá\s+(.+)$/.exec(t))) done.push('✓ Đã xoá: ' + name(m[1] || ''));
    else if ((m = /^✓ đã thêm\s+(.+)$/.exec(t))) done.push('✓ Đã thêm: ' + name(m[1] || ''));
    else if ((m = /^· (.+): chuyến đã có file này$/.exec(t))) done.push('✓ Đã có sẵn: ' + m[1]);
    else if ((m = /^! thiếu file "(.+?)"/.exec(t)) || (m = /^✗ thêm (.+?): thiếu file/.exec(t)))
      bad.push('✗ Chưa thêm được: ' + m[1] + ' — thiếu file trong kho MEL/notice (bấm ✂ Tách MEL lại hoặc tải file lên rồi thử)');
    else if (/^✗ tài khoản không có quyền XOÁ/i.test(t)) bad.push('✗ Tài khoản FliteBrief không có quyền xoá file cũ — chưa đổi gì');
    else if (/^✗ tài khoản không có quyền đính kèm/i.test(t)) bad.push('✗ Tài khoản FliteBrief không có quyền đính kèm file — chưa đổi gì');
    else if ((m = /^✗ không xoá được (.+)$/.exec(t))) bad.push('✗ Chưa xoá được: ' + m[1] + ' (FliteBrief từ chối xoá)');
    else if ((m = /^✗ thêm (.+?): (.*)$/.exec(t))) bad.push('✗ Chưa thêm được: ' + m[1] + ' — FliteBrief báo: ' + (m[2] || 'lỗi không rõ'));
    else if (/^✗ /.test(t) && !/^✗ xoá /.test(t)) bad.push(t);
  }
  if (!ended) bad.push('✗ Mất kết nối khi đang cập nhật — kiểm tra lại FliteBrief trước khi bấm lại');
  if (!bad.length) bad.push('✗ FliteBrief chưa xác nhận xong — kiểm tra lại chuyến trên FliteBrief');
  return [...done, ...bad].join('\n');
}

export function patchCmpSyncPage(html: string): string {
  return html.replace(/async function applyFplVer\(ver\)\{[\s\S]*?(?=\nfunction setOwaState)/, `async function applyFplVer(ver){
  const old = String(ver && ver.old || ""), neu = String(ver && ver.new || "");
  if(!neu) return;
  const sig = JSON.stringify([old, neu]);
  if(sig === window.__fplVerSig){paintVerBang(fplVerApplied);return;}
  const seq = window.__fplApplySeq = (window.__fplApplySeq || 0) + 1;
  await vLoadFiles({preferNewest: false});
  if(seq !== window.__fplApplySeq) return;
  const pair = cmpFplPair(vFileList, Date.now(), true);
  const latest = pair[pair.length - 1];
  if(!latest) return;
  const previous = pair.length === 2 ? pair[0].name : "";
  vSetValue("new", latest.name);
  vSetValue("old", previous);
  vPaintMenus();
  fplVerApplied = {old: previous, new: latest.name};
  window.__fplVerSig = sig;
  paintVerBang(fplVerApplied);
  await cmpReadSyncSources();
  cmpAtcAutoPending = true;
  if(lastCmp && lastCmp.table) cmpAtcAutoRun(lastCmp.table);
  if(mode === "version" && previous && previous !== latest.name) vRun();
}
`)
    // Viewing is acknowledged only after a successful comparison is closed.
    .replace('  if(ver || cmp) verBangAck();', '  if(ver) window.__verSeen = true; else if(window.__verSeen){ window.__verSeen = false; if(window.__verReadFile === verBangFileKey()) verBangAck(); }')
    .replace('function setMode(m){\n  mode = m;', 'function setMode(m){\n  if(typeof cmpVerModalClose === "function") cmpVerModalClose();\n  mode = m;')
    .replace('  const o = $("#vOld").value, n = $("#vNew").value;\n', '  const o = $("#vOld").value, n = $("#vNew").value;\n  window.__verReadFile = "";\n')
    .replace('    vRender(d);\n  }catch(err){', '    vRender(d);\n    window.__verReadFile = n;\n  }catch(err){')
    .replace('id="cmpVerBar" title="File FPL VER đang dùng (BẢN ĐANG DÙNG ở tab Dữ liệu thay đổi)"', 'id="cmpVerBar" role="button" tabindex="0" onclick="cmpVerOpen()" style="cursor:pointer" title="Bấm để so 2 FPL VER gần nhất"')
    .replace('class="mode-bang" id="verBang" role="status" aria-live="polite"', 'class="mode-bang" id="verBang" role="button" tabindex="0" onclick="event.preventDefault();event.stopPropagation();cmpVerOpen()" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();event.stopPropagation();cmpVerOpen()}" aria-live="polite"')
    .replace('onclick="cmpVerOpen()" style="cursor:pointer"', 'onclick="cmpVerOpen()" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();cmpVerOpen()}" style="cursor:pointer"')
    .replace('   bang.title = pending\n', `   const cvb = typeof document !== "undefined" && document.getElementById ? document.getElementById("cmpVerBar") : null;
   if(cvb){ cvb.classList.toggle("cmp-ver-new", pending); cvb.classList.toggle("cmp-ver-seen", !pending); }
   bang.title = (pending\n`)
    .replace('   const pending = verBangFileKey(ver) !== verBangAcked;', '   const pending = cmpFplPair(vFileList, Date.now()).length === 2 && verBangFileKey(ver) !== verBangAcked;')
    .replace('     : "FPL VER " + n + " — đã xem";\n', '     : "FPL VER " + n + " — đã xem") + (typeof cmpVerDetail === "function" ? cmpVerDetail() : "");\n')
    .replace('    vb.textContent = latest ? ("FPL VER đang dùng: " + latest) : "";', `    const vn = parseVerNo(latest);
    vb.textContent = latest ? ("FPL VER " + (vn ? String(vn).padStart(2, "0") : "") + (vn ? " · " : "") + latest) : "";
    if(typeof cmpVerTipPaint === "function") cmpVerTipPaint();`)
    .replace('    bar.title = tip || "File Crewlist Aims đang dùng để đối chiếu";', '    bar.title = tip || "File Crewlist Aims đang dùng để đối chiếu";\n    if(typeof cmpVerTipPaint === "function") cmpVerTipPaint();')
    .replace('</head>', `<style>
#cmpVerDialog{position:fixed;inset:16px;margin:0;box-sizing:border-box;padding:0;border:1px solid var(--atc-line,var(--vj-line));border-radius:8px;background:var(--atc-paper,var(--vj-surface));color:var(--atc-ink,var(--vj-ink));width:calc(100vw - 32px);max-width:none;height:calc(100vh - 32px);max-height:none;overflow:hidden}
#cmpVerDialog[open]{display:flex;flex-direction:column}
#cmpVerDialog::backdrop{background:color-mix(in srgb,var(--atc-ink,var(--vj-ink)) 55%,transparent)}
.cmp-ver-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;background:var(--vj-surface);color:var(--vj-ink);border-bottom:1px solid var(--vj-line);flex-shrink:0;font-size:18px;font-weight:700}
#cmpVerDialog #wrapVer{width:100%;overflow:hidden;flex:1}
#cmpVerDialog .toolbar2{flex-wrap:wrap;flex-shrink:0}
#cmpVerDialog .tbl-wrap{overflow:auto}
#cmpVerBar.cmp-ver-new{color:#fff !important;background:#dc2626 !important;border-color:#dc2626 !important;animation:cmpVerFlash 1s ease-in-out infinite;font-weight:800}
#cmpVerBar.cmp-ver-new::before{background:#fff !important;box-shadow:none !important}
#cmpVerBar.cmp-ver-seen{color:#fff !important;background:#16a34a !important;border-color:#16a34a !important;font-weight:800}
#cmpVerBar.cmp-ver-seen::before{background:#fff !important;box-shadow:none !important}
@keyframes cmpVerFlash{0%,100%{opacity:1}50%{opacity:.45}}
@media(prefers-reduced-motion:reduce){#cmpVerBar.cmp-ver-new{animation:none}}
</style></head>`)
    .replace('   return Number((ver && ver.new_ver) || 0)\n     || parseVerNo((ver && ver.new) || "")', '   return parseVerNo((ver && ver.new) || "")\n     || Number((ver && ver.new_ver) || 0)')
    .replace('    const d = await (await fetch("/api/version/files")).json();\n    vFileList', '    const seq = window.__vFilesSeq = (window.__vFilesSeq || 0) + 1;\n    const response = await fetch("/api/version/files");\n    const d = await response.json();\n    if(!response.ok || d.error || seq !== window.__vFilesSeq) return;\n    vFileList')
    .replace('    vPaintMenus();\n    // Ver mới có thể tới từ mọi đường', `    const fp = cmpFplPair(vFileList, Date.now(), true);
    const cp = cmpCrewPair(vFileList, (xls && xls.file) || d.current || "");
    const selected = fp.length ? fp : cp;
    vSetValue("new", selected[selected.length - 1]?.name || (xls && xls.file) || d.current || "");
    vSetValue("old", selected.length === 2 ? selected[0].name : "");
    vPaintMenus();
    // Ver mới có thể tới từ mọi đường`)
    .replace('  if(!o || !n){ alert("Chưa có đủ 2 file Excel trong data/excel/."); return; }', `  if(!o || !n){
    vLast = null; vDuty = null;
    $("#vBody").innerHTML = '<tr><td colspan="12" class="empty">Chưa có bản trước cùng ngày khai thác.</td></tr>';
    $("#vSum").textContent = ""; $("#vWarn").style.display = "none";
    return;
  }`)
    .replace('        if(vDuty) vRender(vDuty);\n        return;', '        vRun();\n        return;')
    .replace('function renderCompareTable(d, opts){', `
const cmpSourceChange = ${cmpSourceChange.toString()};
const cmpAircraftChange = ${cmpAircraftChange.toString()};
const cmpPilotChanges = ${cmpPilotChanges.toString()};
const cmpCellCrewChanges = ${cmpCellCrewChanges.toString()};
const cmpFplPair = ${cmpFplPair.toString()};
const cmpCrewPair = ${cmpCrewPair.toString()};
const cmpReqChange = ${cmpReqChange.toString()};
const cmpChgFbReady = ${cmpChgFbReady.toString()};
const cmpMsgKind = ${cmpMsgKind.toString()};
const cmpAviOperation = ${cmpAviOperation.toString()};
const cmpRegMemory = ${cmpRegMemory.toString()};
const cmpCrewDelayMin = ${cmpCrewDelayMin.toString()};
const cmpDelayKind = ${cmpDelayKind.toString()};
const cmpRegMemFind = ${cmpRegMemFind.toString()};
const cmpAttachMismatch = ${cmpAttachMismatch.toString()};
const cmpReqKey = ${cmpReqKey.toString()};
const cmpSwapReport = ${cmpSwapReport.toString()};
function cmpSwapStream(id){
  return new Promise(resolve => {
    const lines = [], es = new EventSource("/api/stream?id=" + id);
    es.onmessage = ev => { try{ const m = JSON.parse(ev.data);
      if(m.type === "line") lines.push(m);
      if(m.type === "end"){ es.close(); resolve({complete: !m.failed && !m.error, ended: true, lines}); } }catch(_){} };
    es.onerror = () => { es.close(); resolve({complete: false, ended: false, lines}); };
  });
}
let cmpSyncSources = {stamp:"", crew:[], fpl:[]}, cmpSyncBusy = false, cmpSyncSeq = 0, cmpSyncDiffJob = null;
const CMP_SYNC_CHUNK = 20;
function cmpSourceTip(kind){
  if(kind === "fpl"){
    const file = cmpSyncSources.fplFile || "";
    const previous = cmpSyncSources.fplOld || "";
    const ver = parseVerNo(file);
    return file ? "Đang đối chiếu: FPL" + (ver ? " VER " + String(ver).padStart(2,"0") : "") + " (" + file + ")" + (previous ? "\\nSo với: " + previous : "") : "Nguồn REG FPL: chưa đọc được cặp Excel FPL; dự phòng OFP FliteBrief";
  }
  const file = (typeof xls !== "undefined" && xls && xls.file) || "";
  return file ? "Đang đối chiếu Crewlist: " + file : "Nguồn Crewlist: chưa chọn file; đang hiện dữ liệu FliteBrief";
}
function cmpSourceTipSet(el, kind){
  if(!el) return;
  const key = el === _tipHost ? "data-tip" : el.hasAttribute("title") ? "title" : el.hasAttribute("data-tip") ? "data-tip" : "title";
  let base = el.getAttribute(key) || "";
  if(el._cmpSourcePrefix && base.startsWith(el._cmpSourcePrefix)) base = base.slice(el._cmpSourcePrefix.length);
  const prefix = cmpSourceTip(kind) + (base ? "\\n\\n" : "");
  el._cmpSourcePrefix = prefix;
  el.setAttribute(key, prefix + base);
}
function cmpSourceHeaders(){
  document.querySelectorAll("#cmpHead th").forEach(th=>{
    const label = th.textContent.trim();
    if(["REG FPL","REG AIMS","CREW"].includes(label)) cmpSourceTipSet(th,label === "REG FPL" ? "fpl" : "crew");
  });
}
// Capture before the shared tooltip handler, including child buttons with their own tips.
document.addEventListener("mouseover", ev=>{
  const target = ev.target;
  if(!target || !target.closest) return;
  const cell = target.closest("#cmpBody td[data-fpl-reg-sid],#cmpBody td[data-reg-sid],#cmpBody td[data-crew-sid],#cmpHead th");
  if(!cell) return;
  const label = cell.tagName === "TH" ? cell.textContent.trim() : "";
  if(cell.tagName === "TH" && !["REG FPL","REG AIMS","CREW"].includes(label)) return;
  const kind = cell.hasAttribute("data-fpl-reg-sid") || label === "REG FPL" ? "fpl" : "crew";
  cmpSourceTipSet(cell,kind);
  const child = target.closest("[title],[data-tip]");
  if(child && child !== cell && cell.contains(child)) cmpSourceTipSet(child,kind);
},true);
function cmpVerDetail(){
  try{
    const vo = ($("#vOld") && $("#vOld").value) || "";
    const vne = ($("#vNew") && $("#vNew").value) || "";
    const xf = (typeof xls !== "undefined" && xls && xls.file) || "";
    const parts = [];
    if(vne || vo) parts.push("FPL " + [vo, vne].filter(Boolean).join(" → "));
    if(xf) parts.push("Crewlist: " + xf);
    return parts.length ? " · Đang đối chiếu: " + parts.join(" · ") : "";
  }catch(_){ return ""; }
}
function cmpVerTipPaint(){
  const vb = typeof document !== "undefined" && document.getElementById ? document.getElementById("cmpVerBar") : null;
  if(vb) vb.title = "Bấm để so 2 FPL VER gần nhất" + cmpVerDetail();
}
let cmpVerOpening = false, cmpVerRestore = null, cmpVerReturnFocus = null;
function cmpVerModalFit(){
  const dialog = document.getElementById("cmpVerDialog");
  if(!dialog || !dialog.open) return;
  const zoom = (parseFloat(getComputedStyle(document.documentElement).zoom) || 1) * (parseFloat(getComputedStyle(document.body).zoom) || 1);
  dialog.style.zoom = String(1 / zoom);
}
function cmpVerModalShow(){
  let dialog = document.getElementById("cmpVerDialog");
  if(!dialog){
    dialog = document.createElement("dialog"); dialog.id = "cmpVerDialog";
    dialog.setAttribute("aria-labelledby", "cmpVerDialogTitle");
    const header = document.createElement("div"); header.className = "cmp-ver-dialog-head";
    const title = document.createElement("span"); title.id = "cmpVerDialogTitle"; title.textContent = "Dữ liệu thay đổi · FPL VER";
    const close = document.createElement("button"); close.type = "button"; close.className = "btn small"; close.textContent = "✕"; close.setAttribute("aria-label", "Đóng bảng dữ liệu thay đổi"); close.onclick = cmpVerModalClose;
    header.append(title, close); dialog.appendChild(header); document.body.appendChild(dialog);
    dialog.addEventListener("cancel", ev => {ev.preventDefault();cmpVerModalClose();});
    window.addEventListener("resize", () => requestAnimationFrame(cmpVerModalFit));
  }
  if(dialog.open) return;
  const wrap = $("#wrapVer");
  if(!wrap) return;
  cmpVerReturnFocus = document.activeElement;
  cmpVerRestore = {parent:wrap.parentNode, next:wrap.nextSibling, display:wrap.style.display};
  window.__verReadFile = "";
  tipRelease(); dialog.appendChild(wrap); wrap.style.display = "flex";
  dialog.showModal();
  cmpVerModalFit();
}
function cmpVerModalClose(){
  const dialog = document.getElementById("cmpVerDialog");
  if(!dialog || !dialog.open) return;
  const read = window.__verReadFile;
  const wrap = $("#wrapVer");
  dialog.close();
  if(wrap && cmpVerRestore){
    cmpVerRestore.parent.insertBefore(wrap, cmpVerRestore.next);
    wrap.style.display = cmpVerRestore.display;
  }
  cmpVerRestore = null;
  if(read){ verBangAcked = read; verBangSave(); paintVerBang(fplVerApplied); }
  if(cmpVerReturnFocus && cmpVerReturnFocus.isConnected) cmpVerReturnFocus.focus();
}
async function cmpVerOpen(){
  if(cmpVerOpening) return;
  cmpVerOpening = true;
  try{
    await vLoadFiles({preferNewest: false});
    const pair = cmpFplPair(vFileList, Date.now(), true);
    if(pair.length !== 2){ alert("Chưa có đủ 2 FPL VER cùng ngày để đối chiếu."); return; }
    const latest = pair[1];
    vSetValue("new", latest.name); vSetValue("old", pair[0].name);
    vPaintMenus();
    $("#vOnlyChg").checked = true;
    cmpVerModalShow();
    await vRun();
  }finally{ cmpVerOpening = false; }
}
const cmpSyncChecks = new Map();
const cmpAckStore = (()=>{ try{return new Set(JSON.parse(localStorage.getItem("cmp_ack_v1")||"[]"));}catch(_){return new Set();} })();
function cmpAckHas(k){ return cmpAckStore.has(k); }
const cmpRegMem = (()=>{ try{return JSON.parse(localStorage.getItem("cmp_regmem_v1")||"{}") || {};}catch(_){return {};} })();
function cmpRegMemSave(k, v){ if(v) cmpRegMem[k] = v; else delete cmpRegMem[k]; const keys = Object.keys(cmpRegMem); for(const x of keys.slice(0, Math.max(0, keys.length - 300))) delete cmpRegMem[x]; try{localStorage.setItem("cmp_regmem_v1", JSON.stringify(cmpRegMem));}catch(_){} }
function cmpAckAdd(k){ cmpAckStore.add(k); try{localStorage.setItem("cmp_ack_v1", JSON.stringify([...cmpAckStore].slice(-500)));}catch(_){} }
let cmpSyncRowSource = null, cmpSyncRowIndex = new Map();
function cmpSyncRow(sid){
  const rows = (lastCmp && lastCmp.table) || [];
  if(rows !== cmpSyncRowSource){cmpSyncRowSource=rows;cmpSyncRowIndex=new Map(rows.map(r=>[String(r.sector_id),r]));}
  return cmpSyncRowIndex.get(String(sid));
}
/** Live Compare mismatch (FliteBrief vs the loaded Crewlist) — needs no second Crewlist version. */
function cmpLiveChange(r){
  const f = cmpActionFlight(r);
  if(!f || !xls || !xls.file) return null;
  const bound = cmpBind[String(r.sector_id)];
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const g = (bound && bound.reg && bound.reg.verdict) ? bound.reg : r.reg_cmp;
  const reg = g && g.verdict && !g.same && norm(g.excel) && norm(g.flite) && norm(g.excel) !== norm(g.flite)
    ? {changed:true, old:String(g.flite).trim(), new:String(g.excel).trim()} : {changed:false, old:"", new:""};
  const cached = typeof C_CACHE === "object" && C_CACHE ? C_CACHE[r.sector_id] : null;
  const c = (bound && bound.crew && bound.crew.verdict) ? bound.crew : (r.crew && r.crew.verdict ? r.crew : cached);
  const crewChanges = c && c.verdict && !c.same && c.excel ? cmpCellCrewChanges(c.excel, c.detail) : [];
  const crew = crewChanges.length ? {changed:true, live:true, raw_old:"FliteBrief: " + (c.flite || ""), raw_new:c.excel} : {changed:false};
  if(!reg.changed && !crew.changed) return null;
  return {sector_id:f.id, fb_std:f.std, live:true, ops_ok:true, reg, crew, crewChanges};
}
function cmpSyncEvidence(r, kind){
  const f = cmpActionFlight(r);
  if(!f) return null;
  // Version rows only count for the loaded Crewlist; live mismatches never wait for (or depend on) that diff.
  const fresh = cmpSyncSources.current === ((xls && xls.file) || cmpSyncSources.current);
  const row = fresh ? cmpSourceChange(kind === "fpl" ? cmpSyncSources.fpl : cmpSyncSources.crew, f.id, f.std) : null;
  const bound = cmpBind[String(r.sector_id)];
  if(kind === "crew"){
    // FliteBrief differs from the loaded Crewlist now: that is the swap to offer, whatever the version diff says.
    const live = cmpLiveChange(r);
    if(live && live.crew.changed) return {f, kind, changes:live.crewChanges, row:{sector_id:f.id, reg:{}, crew:live.crew}};
    if(!(row && row.crew && row.crew.changed && cmpPilotChanges(row.crew.raw_old, row.crew.raw_new).length)) return null;
  }
  if(kind === "aims" && !(row && cmpAircraftChange(row.reg))){
    // Crewlist aircraft differs from FliteBrief now, even without a Crewlist-to-Crewlist change.
    const live = cmpLiveChange(r);
    if(!live || !live.reg.changed){
      // FliteBrief already on the Crewlist aircraft but the attached aircraft file is another tail.
      const g = (bound && bound.reg && bound.reg.verdict) ? bound.reg : r.reg_cmp;
      const a = xls && xls.file && g && g.verdict ? cmpAttachMismatch(g, f.reg_atch) : null;
      return a ? {f, kind, changes:[], row:{sector_id:f.id, reg:a, crew:{}}} : null;
    }
    return {f, kind, changes:[], row:{sector_id:f.id, reg:live.reg, crew:{}}};
  }
  if(!row || !(kind === "crew" ? row.crew && row.crew.changed : cmpAircraftChange(row.reg))) return null;
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
  if(!response.ok || d.error) throw new Error(d.error || "Không tìm thấy đúng chuyến/ngày/chặng.");
  return cmpSyncApply(e, it);
}
/** One fresh FliteBrief read per chunk for every changed flight on the current Compare table. */
async function cmpSyncCheckMany(list, onChunk){
  for(let i=0;i<list.length;i+=CMP_SYNC_CHUNK){
    const chunk = list.slice(i,i+CMP_SYNC_CHUNK);
    let d = null;
    try{
      const response = await fetch("/api/version/fbreg", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({items:chunk.map(cmpSyncIdentity)})});
      d = await response.json();
      if(!response.ok || d.error) d = null;
    }catch(_){ d = null; }
    if(d) chunk.forEach((e,ix)=>{try{cmpSyncApply(e, d.items && d.items[ix]);}catch(_){/* unreadable never means matched */}});
    if(onChunk && onChunk(chunk) === false) return;
  }
}
function cmpSyncApply(e, it){
  if(!it || !it.found || String(it.sector_id) !== String(e.f.id)) throw new Error((it && it.error) || "Không tìm thấy đúng chuyến/ngày/chặng.");
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  let ok, regOk = false, atchOk = false;
  if(e.kind === "crew"){
    if(!e.changes.length || !it.crew_checked) throw new Error(it.crew_error || "Chưa đọc được mã/vai trò phi công — không gửi thay đổi.");
    ok = e.changes.every(c => (it.crew_changes || []).some(x => x.key === c.key && x.from === c.from && x.to === c.to && x.ok));
  }else{
    const want = (norm(e.row.reg.new).match(/(\\d{3})$/) || [])[1] || "";
    regOk = !!it.reg && norm(it.reg) === norm(e.row.reg.new);
    atchOk = !!want && String(it.reg_atch || "") === want;
    // Two layers: the frame follows the attached aircraft file; the text follows the OFP.
    ok = atchOk;
  }
  cmpSyncChecks.set(cmpSyncKey(e), {ok, regOk, atchOk, file: String(it.reg_atch_file || "")});
  return ok;
}
function cmpSyncWrapText(td){
  Array.from(td.childNodes).forEach(n => {
    if(n.nodeType === 3 && n.textContent.trim()){
      const s = document.createElement("span");
      s.className = "cmp-sync-orig";
      s.textContent = n.textContent;
      td.replaceChild(s, n);
    }
  });
}
function cmpSyncPaint(r, kind){
  const attr = kind === "crew" ? "data-crew-sid" : kind === "aims" ? "data-reg-sid" : "data-fpl-reg-sid";
  const td = document.querySelector('#cmpBody td[' + attr + '="' + r.sector_id + '"]');
  if(!td) return;
  td.querySelectorAll(".cmp-sync-action,.cmp-sync-pick,.cmp-two").forEach(b => b.remove());
  cmpSyncWrapText(td);
  Array.from(td.children).forEach(el => {el.hidden = false;});
  const e = cmpSyncEvidence(r, kind);
  if(kind === "fpl"){
    // REG FPL only flags the change in red; the aircraft swap button lives in REG AIMS.
    td.classList.toggle("cmp-fpl-mismatch", !!e);
    if(e){ td.classList.remove("cmp-fpl-match"); td.dataset.tip = "FPL đổi tàu: " + e.row.reg.old + " → " + e.row.reg.new; }
    return;
  }
  if(!e) return;
  const checked = cmpSyncChecks.get(cmpSyncKey(e));
  const b = document.createElement("button"); b.type = "button";
  const ok = checked && checked.ok;
  if(ok && cmpAckHas("s|" + cmpSyncKey(e))) return;
  if(!ok && cmpAckHas("x|" + cmpSyncKey(e))) return;
  b.className = "regbtn cmp-sync-action" + (ok ? " synced" : "");
  b.textContent = kind === "crew" ? (ok ? "✓ Crew" : "↻ Crew") : (ok ? "✓ " : "⚠ ") + e.row.reg.new;
  if(ok && kind !== "crew" && checked && !checked.regOk){
    b.classList.add("cmp-reg-ofp-wait");
    b.textContent = "";
    const t = document.createElement("span"); t.className = "cmp-reg-ofp-old"; t.textContent = "⚠ " + e.row.reg.new;
    b.append(t);
  }
  if(!ok && kind !== "crew"){
    b.classList.add("cmp-wrong-ac");
    if(checked && checked.regOk){
      b.classList.add("cmp-reg-ofp-ok");
      b.textContent = "";
      const t = document.createElement("span"); t.className = "cmp-reg-ofp-txt"; t.textContent = "✓ " + e.row.reg.new;
      b.append(t);
    }
  }
  b.disabled = (!ok && cmpSyncBusy) || (kind === "crew" && !e.changes.length);
  b.setAttribute("aria-label", (kind === "crew" ? "Đổi crew " : "Đổi tàu ") + e.f.callsign + " theo " + (kind === "fpl" ? "FPL mới" : "Crewlist mới"));
  b.dataset.tip = (kind === "crew" ? String(e.row.crew.raw_old || "") + " → " + String(e.row.crew.raw_new || "") : (e.row.reg.attach ? "File tàu attach sai: " : "") + e.row.reg.old + " → " + e.row.reg.new)
    + (kind !== "crew" && checked && !ok && checked.regOk ? " · OFP đã đúng tàu mới" : "")
    + (kind !== "crew" && checked && !ok ? " · File tàu trên FliteBrief: " + (checked.file || "chưa có") + " — chưa khớp tàu mới" : "") + (ok ? " · Đã khớp file tàu FliteBrief" : kind === "crew" && !e.changes.length ? " · Chưa đọc được mã/vai trò phi công" : " · Bấm xem trước và xác nhận");
  if(ok) b.dataset.tip += " · Bấm để xác nhận đã biết";
  b.onclick = ev => {ev.stopPropagation(); if(ok){cmpAckAdd("s|" + cmpSyncKey(e)); cmpSyncPaint(r, kind); return;} cmpSyncOpen(r, kind);};
  if(!ok){ b.dataset.twoLabel = kind === "crew" ? "Đổi crew" : "Đổi tàu"; b._cmpAck = () => { cmpAckAdd("x|" + cmpSyncKey(e)); cmpSyncPaint(r, kind); }; }
  if(kind === "crew" && !e.changes.length && !ok) b.disabled = true;
  if(kind === "crew") td.prepend(b);
  else if(kind === "fpl") { Array.from(td.children).forEach(el => {el.hidden = true;}); td.prepend(b); }
  else { Array.from(td.children).forEach(el => {if(!el.classList.contains("cmp-sync-pick")) el.hidden = true;}); td.prepend(b); }
  if(kind !== "fpl" && xls && xls.file){
    const pick = document.createElement("button"); pick.type = "button"; pick.className = "cmp-sync-pick"; pick.textContent = "≡";
    pick.setAttribute("aria-label", "Chọn dòng Crewlist " + e.f.callsign); pick.dataset.tip = "Chọn dòng Crewlist";
    pick.onclick = ev => {ev.stopPropagation();cmpOpenPick(r.sector_id,td);}; td.appendChild(pick);
  }
}
const cmpReqDone = new Set(), cmpReqBusy = new Set();
function cmpReqEvidence(r){
  const f = cmpActionFlight(r);
  if(!f || !xls || !xls.file) return null;
  let row = cmpSyncSources.current === xls.file ? cmpReqChange(cmpSyncSources.crew, f.id, f.std) : null;
  if(!row && typeof cmpLiveChange === "function"){ const live = cmpLiveChange(r); if(live) row = {sector_id:live.sector_id, fb_std:live.fb_std, ops_ok:true, reg:live.reg, crew:live.crew}; }
  if(!row) return null;
  const bound = cmpBind[String(r.sector_id)];
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const reg = ((bound && bound.reg) || r.reg_cmp || {}).excel;
  if(reg && row.reg && row.reg.new && norm(reg) !== norm(row.reg.new)) return null;
  if(bound && bound.crew && bound.crew.excel && row.crew && row.crew.raw_new
    && String(bound.crew.excel).trim() !== String(row.crew.raw_new).trim()) return null;
  let uid = "";
  try{uid = window.parent.__fbUserId ? window.parent.__fbUserId() || "" : "";}catch(_){}
  const key = cmpReqKey(uid, {id:f.id,callsign:f.callsign,std:f.std,dep:f.dep_icao || f.dep,arr:f.dest_icao || f.dest}, row);
  return {f,row,uid,key};
}
function cmpReqPaint(r){
  const td = document.querySelector('#cmpBody td[data-w="cfp"][data-sid="' + r.sector_id + '"]');
  if(!td) return;
  td.querySelectorAll(".cmp-cfp-req,.cmp-two").forEach(b=>b.remove());
  const value = td.querySelector(".v");
  if(value) value.hidden = false;
  const e = cmpReqEvidence(r);
  if(!e) return;
  let done = cmpReqDone.has(e.key);
  if(!done && e.uid){try{done = localStorage.getItem("sohee:compare-req:v1:" + e.key) === "1";}catch(_){}}
  if(done) return;
  const b = document.createElement("button"); b.type = "button"; b.className = "briefbtn cmp-cfp-req";
  b.textContent = r.cfp_no || "—";
  b.disabled = cmpReqBusy.has(e.key);
  b.title = "Crewlist đổi " + (cmpAircraftChange(e.row.reg) ? "tàu" : "crew") + " — bấm xuất FPL.req; PAY, Extra và DSP giữ từ OFP cũ";
  b.setAttribute("aria-label", "Xuất REQ " + e.f.callsign + " CFP " + (r.cfp_no || "—"));
  b.onclick = async ev => {
    ev.stopPropagation();
    const live = cmpReqEvidence(r);
    if(!live || live.key !== e.key){alert("Dữ liệu chuyến đã thay đổi — bấm Cmp lại.");return;}
    if(cmpReqBusy.has(e.key)) return;
    cmpReqBusy.add(e.key); b.disabled = true;
    const reqRow = {...live.row,sector_id:live.f.id,flt:live.f.callsign,
      route:r.dep + "-" + r.arr,day_new:live.row.day_new || new Date(live.f.std).toISOString().slice(0,10)};
    try{
      const cell = vReqCell(reqRow, () => {
        cmpReqDone.add(e.key);
        if(e.uid){try{localStorage.setItem("sohee:compare-req:v1:" + e.key,"1");}catch(_){}}
      });
      const action = cell.querySelector("button");
      if(!action || !action.onclick) throw new Error("Không xuất được REQ cho thay đổi này.");
      await action.onclick(ev);
    }catch(error){alert(error.message || "Không xuất được REQ.");}
    finally{cmpReqBusy.delete(e.key);cmpReqPaint(r);}
  };
  b.dataset.twoLabel = "REQ";
  b._cmpAck = () => {
    cmpReqDone.add(e.key);
    if(e.uid){try{localStorage.setItem("sohee:compare-req:v1:" + e.key,"1");}catch(_){}}
    cmpReqPaint(r);
  };
  if(value) value.hidden = true;
  td.prepend(b);
}
function cmpMsgPaint(r){
  const td = document.querySelector('#cmpBody td[data-cmp-msg-sid="' + r.sector_id + '"]');
  const menu = td && td.querySelector("select.cmp-message-select");
  if(!menu) return;
  td.querySelectorAll(".cmp-msg-quick,.cmp-two").forEach(b => b.remove());
  menu.hidden = false;
  const f = cmpActionFlight(r);
  const row = f && cmpSyncSources.current === ((xls && xls.file) || cmpSyncSources.current) ? cmpSourceChange(cmpSyncSources.fpl, f.id, f.std) : null;
  const fplRaw = String((row && row.atc && row.atc.kind) || "").toUpperCase();
  const crewRow = f && cmpSyncSources.current === ((xls && xls.file) || cmpSyncSources.current) ? cmpSourceChange(cmpSyncSources.crew, f.id, f.std) : null;
  // Delay also comes from the Crewlist (diff row or the live STD→ETD shown in the table), not only the FPL pair.
  const raw = cmpDelayKind(fplRaw, crewRow && crewRow.delay, r.crew_std, r.crew_etd);
  const crewDly = !fplRaw && raw === "DLA";
  const liveRow = f ? cmpLiveChange(r) : null;
  const bound = cmpBind[String(r.sector_id)];
  const g = (bound && bound.reg && bound.reg.verdict) ? bound.reg : r.reg_cmp;
  // Live aircraft change is remembered per sector: pushing the corrected CFP must not turn CHG DLA back into DLA.
  // Keyed by sector + callsign (no STD): a delay moves the FliteBrief STD and must not drop the remembered change.
  const memKey = JSON.stringify([f && f.id, f && f.callsign]);
  const memPrev = f ? cmpRegMemFind(cmpRegMem, f.id, f.callsign, f.std) : null;
  const mem = f ? cmpRegMemory(memPrev && memPrev.value, liveRow && liveRow.reg, liveRow ? g : null) : null;
  if(f && memPrev && memPrev.key !== memKey) cmpRegMemSave(memPrev.key, null);
  if(f && JSON.stringify(mem || null) !== JSON.stringify(cmpRegMem[memKey] || null)) cmpRegMemSave(memKey, mem);
  const acChg = (row && cmpAircraftChange(row.reg)) || (crewRow && cmpAircraftChange(crewRow.reg)) || !!(liveRow && liveRow.reg.changed) || !!mem;
  const kind = cmpMsgKind(raw, !!acChg);
  if(!kind) return;
  const ackKey = "m|" + JSON.stringify([f.id, f.callsign, f.std, kind, row && row.reg, crewRow && crewRow.reg, mem || (liveRow && liveRow.reg.changed ? liveRow.reg : null)]);
  if(cmpAckHas(ackKey)) return;
  const b = document.createElement("button"); b.type = "button"; b.className = "cmp-msg-quick";
  b.textContent = kind === "CHG A/C" ? "CHG" : kind;
  const newReg = (crewRow && cmpAircraftChange(crewRow.reg) && crewRow.reg.new) || (row && cmpAircraftChange(row.reg) && row.reg.new) || (mem && mem.new) || "";
  const aimsEv = cmpSyncEvidence(r, "aims"), aimsChk = aimsEv ? cmpSyncChecks.get(cmpSyncKey(aimsEv)) : null;
  const fbOk = kind.indexOf("CHG") === 0 && !(liveRow && liveRow.reg.changed) && cmpChgFbReady(g, newReg, !!(aimsChk && aimsChk.regOk));
  if(fbOk) b.classList.add("cmp-msg-ok");
  b.dataset.tip = (crewDly ? "Crewlist delay " + ((crewRow && crewRow.delay && crewRow.delay.changed && crewRow.delay.from) || r.crew_std || "") + " → " + ((crewRow && crewRow.delay && crewRow.delay.changed && crewRow.delay.to) || r.crew_etd || "") + (mem ? " · đổi tàu " + mem.old + " → " + mem.new : "") + ": " : fplRaw ? "FPL mới so với FPL cũ: " : liveRow && liveRow.reg.changed ? "Crewlist " + liveRow.reg.new + " khác FliteBrief " + liveRow.reg.old + ": " : mem ? "Crewlist đổi tàu " + mem.old + " → " + mem.new + ": " : "Crewlist đổi tàu: ") + kind
    + (fbOk ? " · FliteBrief đã lên đúng tàu Crewlist " + ((g && g.excel) || newReg) : kind.indexOf("CHG") === 0 ? " · FliteBrief chưa lên đúng tàu Crewlist" : "") + " · Bấm để soạn điện văn";
  b.setAttribute("aria-label", "Soạn " + kind + " " + f.callsign);
  b.disabled = menu.disabled;
  b._cmpMessageOpen = channel => menu._cmpMessageOpen(kind, channel);
  b.onclick = ev => {ev.stopPropagation(); return b._cmpMessageOpen("AMHS");};
  b._cmpAck = () => { cmpAckAdd(ackKey); cmpMsgPaint(r); };
  td.prepend(b);
}
/* Pop-up action buttons: a real click splits the button into Ack (hide the warning for this change) and the main action.
   Programmatic clicks (batch "Tất cả") keep running the main action directly. */
const CMP_TWO_SEL = ".cmp-msg-quick,.cmp-sync-action,.cmp-cfp-req,td[data-cmp-brief-sid] .briefbtn";
function cmpTwoClose(keep){
  document.querySelectorAll("#cmpBody .cmp-two").forEach(w => {
    if(w === keep) return;
    const o = w._cmpFor; w.remove();
    if(o) o.style.display = "";
  });
}
function cmpTwoOpen(b){
  cmpTwoClose();
  const w = document.createElement("span"); w.className = "cmp-two"; w._cmpFor = b;
  const ack = document.createElement("button"); ack.type = "button"; ack.className = "cmp-two-ack"; ack.textContent = "Ack";
  ack.title = "Đã biết — tắt cảnh báo này, ô trở về bình thường";
  const go = document.createElement("button"); go.type = "button"; go.className = "cmp-two-go";
  go.textContent = b.dataset.twoLabel || (b.textContent || "").trim() || "Làm";
  go.title = b.dataset.tip || b.title || "";
  ack.onclick = ev => { ev.stopPropagation(); w.remove(); b.style.display = ""; b._cmpAck(); };
  go.onclick = ev => { ev.stopPropagation(); w.remove(); b.style.display = ""; if(typeof b.onclick === "function") b.onclick(ev); };
  w.append(ack, go);
  if(typeof b._cmpMessageOpen === "function"){
    w.classList.add("cmp-two-message");
    go.textContent = "AMHS"; go.title = "Soạn " + b.textContent + " để copy/xuất điện văn AMHS";
    const avi = document.createElement("button"); avi.type = "button"; avi.className = "cmp-two-go cmp-two-avi";
    avi.textContent = "AviWeb"; avi.title = "Chỉnh và xác nhận gửi " + b.textContent + " qua AviWeb";
    avi.onclick = ev => { ev.stopPropagation(); w.remove(); b.style.display = ""; b._cmpMessageOpen("AviWeb"); };
    w.appendChild(avi);
  }
  b.style.display = "none";
  b.after(w);
}
document.addEventListener("click", ev => {
  const t = ev.target;
  if(!ev.isTrusted || !t || !t.closest) return;
  const inTwo = t.closest(".cmp-two");
  if(inTwo){ cmpTwoClose(inTwo); return; }
  const b = t.closest(CMP_TWO_SEL);
  if(!b || !b.closest("#cmpBody") || b.disabled || b.classList.contains("done") || typeof b._cmpAck !== "function"){ cmpTwoClose(); return; }
  ev.stopPropagation(); ev.preventDefault();
  cmpTwoOpen(b);
}, true);
document.addEventListener("keydown", ev => { if(ev.key === "Escape") cmpTwoClose(); });
function cmpSyncRepaint(rows){ for(const r of (rows || ((lastCmp && lastCmp.table) || []))){ for(const kind of ["crew","aims","fpl"]) cmpSyncPaint(r,kind); cmpMsgPaint(r); if(typeof cmpReqPaint === "function") cmpReqPaint(r); } }
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
      crew ? "Crewlist: " + e.row.crew.raw_old + " → " + e.row.crew.raw_new : (e.row.reg.attach ? "File tàu attach: " : "Tàu: ") + e.row.reg.old + " → " + e.row.reg.new];
    for(const x of (crew ? d.remove : d.delete) || []) L.push("− " + (x.label || x.username || x.filename));
    for(const x of d.add || []) L.push("+ " + (x.label || x.username || x.title) + (x.found === false ? " (thiếu file)" : ""));
    if(!crew) L.push("Thao tác giống tab Dữ liệu thay đổi: cập nhật file đính kèm theo tàu mới; không sửa tàu của OFP.");
    if(!confirm(L.join("\\n") + "\\n\\nXác nhận cập nhật lên FliteBrief?")) return;
    if(!cmpSyncEvidence(r,kind) || cmpSyncKey(cmpSyncEvidence(r,kind)) !== cmpSyncKey(e)) throw new Error("Nguồn đã thay đổi — bấm Cmp rồi thử lại.");
    if(await cmpSyncCheck(e)) return;
    const run = await fetch(base + "/run",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
    const job = await run.json(); if(!run.ok || job.error || !job.id) throw new Error(job.error || "Không gửi được thay đổi.");
    const run2 = await cmpSwapStream(job.id); await cmpSyncCheck(e);
    if(!run2.complete) throw new Error(e.f.callsign + " — chưa cập nhật xong:\\n" + cmpSwapReport(run2.lines, run2.ended));
    if(!cmpSyncChecks.get(cmpSyncKey(e)).ok) alert(kind === "crew" ? "Đã xử lý; FliteBrief chưa khớp crew mới." : "Đã xử lý; file tàu trên FliteBrief chưa khớp tàu mới.");
  }catch(error){alert(error.message || "Không cập nhật được.");}
  finally{cmpSyncBusy=false;cmpSyncRepaint();}
}
async function cmpReadSyncSources(){
  const seq = ++cmpSyncSeq;
  try{
    const response = await fetch("/api/version/files"), d = await response.json();
    if(!response.ok || d.error || seq !== cmpSyncSeq) return;
    const files = d.files || [], current = (xls && xls.file) || d.current;
    const pairs = {crew: cmpCrewPair(files,current), fpl:cmpFplPair(files,Date.now(),true)};
    const stamp = JSON.stringify([current,pairs]);
    if(cmpSyncSources.stamp !== stamp){
      // Share one in-flight diff per source pair: an upload starts it, the table render reuses it.
      let job = cmpSyncDiffJob && cmpSyncDiffJob.stamp === stamp ? cmpSyncDiffJob.promise : null;
      if(!job){
        job = Promise.all(["crew","fpl"].map(async kind=>{
          if(!pairs[kind].length || (kind === "crew" && pairs[kind].length !== 2)) return [];
          const latest = pairs[kind][pairs[kind].length - 1];
          const p = new URLSearchParams({old:pairs[kind].length === 2 ? pairs[kind][0].name : "",new:latest.name});
          if(kind==="fpl") p.set("all","1");
          const res = await fetch("/api/version/diff?"+p), diff = await res.json();
          if(!res.ok || diff.error) throw new Error(diff.error || "Chưa đọc được phiên bản.");
          return diff.rows || [];
        }));
        cmpSyncDiffJob = {stamp, promise: job};
        job.catch(()=>{ if(cmpSyncDiffJob && cmpSyncDiffJob.promise === job) cmpSyncDiffJob = null; });
      }
      let results = null;
      try{ results = await job; }catch(_){ results = null; }
      // A failed version diff gives no version evidence but must not hide live FliteBrief≠Crewlist actions; retry next tick.
      if(!results) cmpSyncSources={stamp:"",current,crew:[],fpl:[],fplOld:"",fplFile:""};
      else if(cmpSyncSources.stamp !== stamp) cmpSyncSources={stamp,current,crew:results[0],fpl:results[1],fplOld:pairs.fpl.length === 2 ? pairs.fpl[0].name : "",fplFile:pairs.fpl[pairs.fpl.length - 1]?.name || ""};
      if(seq!==cmpSyncSeq) return;
    }
    cmpSourceHeaders();
    // Only flights on the current Compare table (already filtered by the chosen DSP) are checked.
    const targets = ((lastCmp && lastCmp.table) || []).flatMap(r=>["crew","aims","fpl"].map(kind=>cmpSyncEvidence(r,kind)).filter(Boolean));
    if(typeof cmpRegRepaint === "function") cmpRegRepaint();
    cmpSyncRepaint();
    await cmpSyncCheckMany(targets, chunk=>{
      if(seq!==cmpSyncSeq) return false;
      cmpSyncRepaint([...new Set(chunk.map(e=>cmpSyncRow(e.f.id)).filter(Boolean))]);
    });
  }catch(_){/* Source errors do not authorize a new action. */}
}
setInterval(()=>{if(!document.hidden && !cmpSyncBusy && document.querySelector("#cmpBody")?.offsetParent!==null) cmpReadSyncSources();},60000);
const cmpSyncFillCrew = fillCrewCell;
fillCrewCell = function(...args){const td=cmpSyncFillCrew(...args);const r=cmpSyncRow(td.dataset.crewSid);if(r){cmpSyncPaint(r,"crew");cmpMsgPaint(r);if(typeof cmpReqPaint==="function")cmpReqPaint(r);}cmpSourceTipSet(td,"crew");return td;};
const cmpSyncFillReg = fillRegCell;
fillRegCell = function(...args){const td=cmpSyncFillReg(...args);const r=cmpSyncRow(td.dataset.regSid);if(r){cmpRegPaint(r);cmpSyncPaint(r,"aims");}cmpSourceTipSet(td,"crew");return td;};
function renderCompareTable(d, opts){`)
    .replace('    head.appendChild(th);\n  }', '    head.appendChild(th);\n  }\n  cmpSourceHeaders();')
    .replace('  const cell = document.querySelector(\'#cmpBody td[data-cmp-brief-sid="\' + r.sector_id + \'"]\');', '  cmpSourceTipSet(td,"fpl");\n  const cell = document.querySelector(\'#cmpBody td[data-cmp-brief-sid="\' + r.sector_id + \'"]\');')
    .replace('  cmpOpsRepaint(rows);', '  cmpReadSyncSources();\n  cmpOpsRepaint(rows);')
    // Start the Crewlist diff as soon as the upload is saved, in parallel with the Compare read.
    .replace('    lastCmp = null; xlsData = null;\n    await acLoadRegContext();', '    lastCmp = null; xlsData = null;\n    if(typeof cmpReadSyncSources === "function") cmpReadSyncSources();\n    await acLoadRegContext();')
    .replace('function vReqCell(r){', 'function vReqCell(r, onReqDone){')
    .replace('    const box = document.getElementById("ftDspBox");\n    const dsp = ((box && box.value) || r.dsp || "").trim();', '')
    .replace('date: r.day_new || "", dsp: dsp,', 'date: r.day_new || "",')
    .replace('      const bin = atob(d.file); const bytes = new Uint8Array(bin.length);', '      if(!d.ok || !d.file) throw new Error("Không nhận được file REQ.");\n      const bin = atob(d.file); const bytes = new Uint8Array(bin.length);')
    .replace('      b.classList.add("done");\n    }catch(e){ alert("REQ lỗi: " + e.message); }', '      b.classList.add("done");\n      if(onReqDone) onReqDone();\n    }catch(e){ alert("REQ lỗi: " + e.message); }')
    .replace('function cmpRegRepaint(){', 'function cmpRegRepaint(){\n  cmpSyncRepaint();')
    .replace('  td.title = "FPL: "', '  cmpSyncPaint(r, "fpl");\n  td.title = "FPL: "')
    .replace('</head>', `<style>
.cmptbl .cmp-cfp-req{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:38px;padding:0 8px;box-sizing:border-box;border:2px solid var(--red)!important;border-radius:999px;background:var(--panel)!important;color:var(--text)!important;-webkit-text-fill-color:currentColor!important;font:inherit;font-weight:800;letter-spacing:0;cursor:pointer;animation:cmpReqPulse 1.4s ease-in-out infinite}
.cmptbl .cmp-cfp-req:focus-visible{outline:2px solid var(--red);outline-offset:4px}
.cmptbl .cmp-cfp-req:disabled{cursor:wait;animation:none;opacity:.65}
.cmptbl td [hidden]{display:none!important}
@keyframes cmpReqPulse{0%,100%{box-shadow:0 0 0 1px color-mix(in srgb,var(--red) 25%,transparent)}50%{box-shadow:0 0 0 5px color-mix(in srgb,var(--red) 45%,transparent)}}
@media(prefers-reduced-motion:reduce){.cmptbl .cmp-cfp-req{animation:none}}
.cmptbl .cmp-sync-action{display:inline-flex;align-items:center;justify-content:center;min-width:70px;min-height:30px;padding:4px 9px;border:2px solid var(--red)!important;border-radius:7px;background:var(--panel)!important;color:var(--red)!important;-webkit-text-fill-color:currentColor!important;font-family:inherit;font-weight:800;font-size:12px;line-height:1.3;cursor:pointer;letter-spacing:0}
.cmptbl .cmp-sync-action.cmp-wrong-ac{gap:5px;min-width:96px;min-height:32px;padding:5px 12px;border:0!important;border-radius:999px;background:linear-gradient(135deg,#ef4444,#b91c1c)!important;color:#fff!important;font-size:13px;letter-spacing:.3px;box-shadow:0 0 0 3px rgba(239,68,68,.22),0 4px 12px rgba(185,28,28,.35);animation:cmpWrongAc 1.8s ease-in-out infinite}
.cmptbl .cmp-sync-action.cmp-wrong-ac:hover{transform:translateY(-1px);box-shadow:0 0 0 4px rgba(239,68,68,.3),0 6px 16px rgba(185,28,28,.45)}
@keyframes cmpWrongAc{0%,100%{box-shadow:0 0 0 3px rgba(239,68,68,.22),0 4px 12px rgba(185,28,28,.35)}50%{box-shadow:0 0 0 7px rgba(239,68,68,.08),0 4px 12px rgba(185,28,28,.35)}}
@media (prefers-reduced-motion:reduce){.cmptbl .cmp-sync-action.cmp-wrong-ac{animation:none}}
.cmptbl .cmp-sync-action.cmp-wrong-ac.cmp-reg-ofp-ok{background:var(--panel)!important;border:3px solid #dc2626!important;animation:none;box-shadow:0 0 0 3px rgba(239,68,68,.22)}
.cmptbl .cmp-sync-action.synced.cmp-reg-ofp-wait{background:var(--panel)!important;border:3px solid #16a34a!important}
.cmptbl .cmp-reg-ofp-wait .cmp-reg-ofp-old{color:#dc2626!important;-webkit-text-fill-color:#dc2626!important;font-weight:800}
.cmptbl .cmp-reg-ofp-ok .cmp-reg-ofp-txt{color:#16a34a!important;-webkit-text-fill-color:#16a34a!important;font-weight:800}
.cmptbl .cmp-sync-action.synced{border-radius:999px!important;border-color:var(--green)!important;background:var(--green)!important;color:var(--atc-on-color)!important;opacity:1}
.cmptbl .cmp-sync-action:disabled:not(.synced){opacity:.55;cursor:default}
.cmptbl .cmp-sync-action:focus-visible,.cmptbl .cmp-sync-pick:focus-visible{outline:2px solid var(--red);outline-offset:3px}
.cmptbl .cmp-msg-quick{display:block;margin:0 auto 4px;min-width:70px;min-height:30px;padding:4px 10px;border:0;border-radius:7px;background:var(--red);color:#fff;font:800 12px/1.3 inherit;cursor:pointer}
.cmptbl .cmp-msg-quick:disabled{opacity:.55}
.cmptbl .cmp-msg-quick.cmp-msg-ok{background:#16a34a;color:#fff}
.cmptbl .cmp-two{display:flex;gap:4px;justify-content:center;align-items:center;margin:0 auto 4px;flex-wrap:nowrap}
.cmptbl .cmp-two button{min-height:26px;padding:3px 8px;border-radius:6px;font:800 11px/1.2 inherit;cursor:pointer;white-space:nowrap}
.cmptbl .cmp-two .cmp-two-ack{border:1.5px solid var(--green);background:var(--panel);color:var(--green)}
.cmptbl .cmp-two .cmp-two-go{border:0;background:var(--red);color:#fff}
.cmptbl .cmp-two-message{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));min-width:98px;max-width:150px}
.cmptbl .cmp-two-message .cmp-two-ack{grid-column:1/-1}
.cmptbl .cmp-two-message button{padding:4px;min-width:0;min-height:28px;letter-spacing:0}
.cmptbl .cmp-two-message .cmp-two-go{background:var(--red)!important;color:var(--atc-on-color)!important;-webkit-text-fill-color:currentColor!important}
.cmptbl .cmp-two-message .cmp-two-avi{background:var(--panel)!important;border:1px solid var(--red)!important;color:var(--red)!important}
.cmptbl .cmp-two-message button:focus-visible{outline:2px solid var(--red);outline-offset:2px}
.cmptbl .cmp-sync-pick{border:0;background:transparent;color:var(--text);font-size:18px;padding:4px;cursor:pointer;vertical-align:middle}
</style></head>`);
}