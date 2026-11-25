// Compare tab batch actions: a header button per action column runs every
// pending cell of that column one after another, after a single confirmation.
// Each flight still goes through its own existing handler and checks.

import globalStyles from '@/styles.css?raw';

export interface BatchItem { sid: string; label: string; detail: string; on?: boolean }
export interface BatchResult { sid: string; label: string; ok: boolean; note: string }

/** Keep only ticked items and drop duplicate sectors, preserving order. */
export function cmpBatchPick(items: BatchItem[]): BatchItem[] {
  const seen = new Set<string>();
  return items.filter(i => {
    if (i.on === false || !i.sid || seen.has(i.sid)) return false;
    seen.add(i.sid);
    return true;
  });
}

/** A drag paints a contiguous range; rows outside it keep their original ticks. */
export function cmpBatchDragSelection(original: boolean[], start: number, end: number, checked: boolean): boolean[] {
  const lo = Math.min(start, end), hi = Math.max(start, end);
  return original.map((value, i) => i >= lo && i <= hi ? checked : value);
}

/** Ack reuses the cell's change-scoped handler, never its operational action. */
export function cmpBatchAck(kind: string, items: BatchItem[], ack: (sid: string) => boolean): BatchResult[] {
  if (kind === 'verify') return [];
  const seen = new Set<string>();
  const out: BatchResult[] = [];
  for (const item of items) {
    if (item.on === false || !item.sid || seen.has(item.sid)) continue;
    seen.add(item.sid);
    let ok = false;
    try { ok = ack(item.sid); } catch { /* Keep a failed/unavailable cell visible. */ }
    out.push({ sid: item.sid, label: item.label, ok, note: ok ? '' : 'Cảnh báo đã thay đổi hoặc không thể Ack' });
  }
  return out;
}

/** Run items sequentially; one failure never stops the rest. */
export async function cmpBatchRun(
  items: BatchItem[],
  exec: (item: BatchItem) => Promise<{ ok: boolean; note?: string }>,
  progress?: (done: number, total: number, item: BatchItem) => void,
): Promise<BatchResult[]> {
  const out: BatchResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (progress) progress(i, items.length, it);
    let r: { ok: boolean; note?: string };
    try { r = await exec(it); } catch (e) { r = { ok: false, note: (e as Error)?.message || String(e) }; }
    out.push({ sid: it.sid, label: it.label, ok: !!r.ok, note: r.note || '' });
  }
  if (progress && items.length) progress(items.length, items.length, items[items.length - 1]);
  return out;
}

export interface VerifyProbe { job: boolean; busy: boolean; done: boolean; ended: boolean }

/**
 * Wait for one quick-verify click to really finish: first until the job has
 * started (or the click already resolved/failed), then until the job ends.
 * Checking right after the click raced the /api/verify/run request and
 * reported a still-running verify as failed.
 */
export async function cmpVerifyWait(
  probe: () => VerifyProbe,
  sleep: (ms: number) => Promise<void>,
  startMs = 120000,
  runMs = 900000,
  stepMs = 300,
): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    const p = probe();
    if (p.job || p.done || p.ended || !p.busy) break;
    if (Date.now() - t0 > startMs) return false;
    await sleep(stepMs);
  }
  const t1 = Date.now();
  for (;;) {
    const p = probe();
    if (!p.job) return p.done || p.ended;
    if (Date.now() - t1 > runMs) return false;
    await sleep(stepMs);
  }
}

// This isolated HTML document shares only the relevant global design tokens.
const TOKENS = globalStyles.match(/--batch-[\w-]+:\s*[^;]+;/g)?.join('\n') || '';
const CSS = `
:root{${TOKENS}}
html.night{--batch-paper:var(--batch-night-paper);--batch-ink:var(--batch-night-ink);--batch-muted:var(--batch-night-muted);--batch-line:var(--batch-night-line);--batch-surface:var(--batch-night-surface);--batch-selected:var(--batch-night-selected);--batch-good-surface:var(--batch-night-surface);--batch-good:var(--batch-night-good)}
html body table.cmptbl thead tr th button.cmp-batch-btn.cmp-batch-btn{display:block;margin:3px auto 0;padding:1px 7px!important;border-radius:6px;border:1px solid var(--batch-on-accent)!important;background:var(--batch-on-accent)!important;color:var(--batch-accent)!important;-webkit-text-fill-color:var(--batch-accent)!important;font-size:10px!important;line-height:16px!important;min-height:0!important;height:auto!important;font-weight:800;letter-spacing:0;cursor:pointer;white-space:nowrap;text-transform:none}
html body table.cmptbl thead tr th button.cmp-batch-btn.cmp-batch-btn:disabled{opacity:.35;cursor:default}
#cmpBatchModal{position:fixed;inset:0 auto auto 0;width:100vw;height:100dvh;zoom:var(--account-body-scale,1);z-index:100000;display:flex;align-items:center;justify-content:center;background:var(--batch-backdrop);padding:20px;box-sizing:border-box;letter-spacing:0;font-family:var(--x-sans,Arial,sans-serif)}
#cmpBatchModal *{box-sizing:border-box;letter-spacing:0}
#cmpBatchModal .bx{background:var(--batch-paper);color:var(--batch-ink);border:1px solid var(--batch-line);border-radius:8px;width:min(920px,100%);max-height:88dvh;display:flex;flex-direction:column;box-shadow:var(--batch-shadow);overflow:hidden}
#cmpBatchModal .hd{display:flex;gap:14px;align-items:center;padding:20px 24px;border-bottom:1px solid var(--batch-line);flex:none}
#cmpBatchModal .hi{display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border-radius:8px;background:var(--batch-selected);color:var(--batch-accent)}
#cmpBatchModal svg{width:20px;height:20px;flex:none}
#cmpBatchModal .hi svg{width:24px;height:24px}
#cmpBatchModal .ht{flex:1;min-width:0}
#cmpBatchModal h2{margin:0;color:var(--batch-ink);font-size:22px;line-height:1.3;font-weight:800;overflow-wrap:anywhere}
#cmpBatchModal .sub{margin-top:5px;font-size:13px;color:var(--batch-muted)}
#cmpBatchModal .tb{display:flex;align-items:center;gap:12px;padding:12px 24px;background:var(--batch-surface);border-bottom:1px solid var(--batch-line);flex:none}
#cmpBatchModal .all{display:flex;align-items:center;gap:10px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap}
#cmpBatchModal .ct{margin-left:auto;font-size:13px;font-weight:700;color:var(--batch-muted);font-variant-numeric:tabular-nums}
#cmpBatchModal input[type=checkbox]{appearance:auto;width:20px;height:20px;margin:0;flex:none;accent-color:var(--batch-accent);cursor:pointer;touch-action:none}
#cmpBatchModal input:focus-visible,#cmpBatchModal button:focus-visible{outline:2px solid var(--batch-accent);outline-offset:3px}
#cmpBatchModal .ls{overflow:auto;overscroll-behavior:contain;min-height:0;flex:1;scrollbar-gutter:stable}
#cmpBatchModal .row{display:grid;grid-template-columns:24px 155px minmax(0,1fr);gap:16px;align-items:center;min-height:76px;padding:15px 24px;border-bottom:1px solid var(--batch-line);cursor:pointer;background:var(--batch-paper)}
#cmpBatchModal .row:last-child{border-bottom:0}
#cmpBatchModal .row.selected{background:var(--batch-selected)}
#cmpBatchModal .row:hover{background:var(--batch-surface)}
#cmpBatchModal .fl{display:flex;flex-direction:column;gap:4px;min-width:0}
#cmpBatchModal .fl b{font-size:16px;font-weight:800;line-height:1.35;overflow-wrap:anywhere}
#cmpBatchModal .rt{font-size:12px;font-weight:600;color:var(--batch-muted);line-height:1.3;overflow-wrap:anywhere}
#cmpBatchModal .dt{color:var(--batch-muted);font:14px/1.55 var(--x-sans,Arial,sans-serif);overflow-wrap:anywhere;white-space:pre-line}
#cmpBatchModal .ft{display:flex;gap:10px;align-items:center;padding:16px 24px;border-top:1px solid var(--batch-line);background:var(--batch-paper);flex:none;flex-wrap:wrap}
#cmpBatchModal .pg{flex:1;min-width:150px;font-size:13px;color:var(--batch-muted);font-weight:600;overflow-wrap:anywhere}
#cmpBatchModal .btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:40px;padding:9px 16px;border:1px solid var(--batch-line)!important;border-radius:6px;background:var(--batch-paper)!important;color:var(--batch-ink)!important;-webkit-text-fill-color:currentColor!important;font:700 14px/1.3 var(--x-sans,Arial,sans-serif);cursor:pointer;box-shadow:none;white-space:nowrap}
#cmpBatchModal .btn.primary{background:var(--batch-accent)!important;border-color:var(--batch-accent)!important;color:var(--batch-on-accent)!important}
#cmpBatchModal .btn{background-image:none!important}
#cmpBatchModal .btn.ack{color:var(--batch-good)!important;border-color:var(--batch-good)!important}
#cmpBatchModal .btn:hover{filter:brightness(.96)}
#cmpBatchModal .btn:disabled{opacity:.45;cursor:default}
#cmpBatchModal .btn.icon{width:36px;min-height:36px;padding:0;border-color:transparent!important;color:var(--batch-muted)!important;flex:none}
#cmpBatchModal .ac{display:flex;align-items:center;gap:12px;padding:12px 24px;border-top:1px solid var(--batch-line);background:var(--batch-good-surface);flex:none;flex-wrap:wrap}
#cmpBatchModal .ac[hidden]{display:none}
#cmpBatchModal .ac strong{flex:1;font-size:14px;color:var(--batch-ink)}
#cmpBatchModal .empty{display:flex;flex-direction:column;align-items:center;gap:12px;padding:56px 24px;color:var(--batch-good);text-align:center;font-size:17px;font-weight:700}
#cmpBatchModal .empty svg{width:36px;height:36px}
#cmpBatchModal .bar{height:5px;background:var(--batch-line);border-radius:3px;overflow:hidden;margin-top:7px}
#cmpBatchModal .bar i{display:block;height:100%;width:0;background:var(--batch-accent);transition:width .2s}
#cmpBatchModal .ok{color:var(--batch-good);font-weight:700}
#cmpBatchModal .bad{color:var(--batch-accent);font-weight:700}
#cmpBatchModal.dragging,#cmpBatchModal.dragging *{user-select:none!important;cursor:ns-resize!important}
@media(max-width:820px){#cmpBatchModal{padding:12px 12px 84px}#cmpBatchModal .bx{max-height:calc(100dvh - 108px)}}
@media(max-width:600px){#cmpBatchModal .hd{padding:16px;gap:10px}#cmpBatchModal h2{font-size:19px}#cmpBatchModal .tb{padding:12px 16px;flex-wrap:wrap}#cmpBatchModal .ct{font-size:12px}#cmpBatchModal .row{grid-template-columns:24px minmax(0,1fr);gap:5px 12px;padding:14px 16px}#cmpBatchModal .row input{grid-row:1/3;align-self:start;margin-top:3px}#cmpBatchModal .fl{flex-direction:row;flex-wrap:wrap;gap:6px 10px;align-items:baseline}#cmpBatchModal .dt{grid-column:2;font-size:13px}#cmpBatchModal .ft{padding:12px 16px;gap:8px}#cmpBatchModal .pg{flex-basis:100%;min-width:0}#cmpBatchModal .ft .btn{flex:1;padding:9px 10px}#cmpBatchModal .ac{padding:12px 16px}#cmpBatchModal .ac strong{flex-basis:100%}}
@media(prefers-reduced-motion:reduce){#cmpBatchModal .bar i{transition:none}}
`;

const SCRIPT = String.raw`
(function(){
  const cmpBatchPick = __PICK__;
  const cmpBatchDragSelection = __DRAG__;
  const cmpBatchAck = __ACK__;
  const cmpBatchRun = __RUN__;
  const cmpVerifyWait = __VWAIT__;
  const COLS = [
    {key:"crew", head:/^CREW\b/, name:"Đổi crew", sel:'td[data-crew-sid] .cmp-sync-action:not(.synced):not(:disabled)', sidAttr:"crewSid"},
    
    {key:"aims", head:/^REG AIMS/, name:"Đổi tàu (AIMS)", sel:'td[data-reg-sid] .cmp-sync-action:not(.synced):not(:disabled)', sidAttr:"regSid"},
    {key:"req", head:/^CFP/, name:"Xuất REQ", sel:'td[data-w="cfp"] .cmp-cfp-req:not(:disabled)', sidAttr:"sid"},
    {key:"msg", head:/^ĐIỆN VĂN/, name:"Điện văn CHG/DLA", sel:'td[data-cmp-msg-sid] .cmp-msg-quick:not(:disabled)', sidAttr:"cmpMsgSid"},
    {key:"brief", head:/^ĐỔI BRIEFING/, name:"Đổi briefing", sel:'td[data-cmp-brief-sid] .briefbtn:not(:disabled):not(.done)', sidAttr:"cmpBriefSid"},
    {key:"verify", head:/^VERIFY/, name:"Verify", sel:'td .cmp-vf:not(:disabled):not(.done)', sidAttr:null},
  ];
  let running = false;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, max){ const t0 = Date.now(); while(!fn()){ if(Date.now() - t0 > (max || 600000)) return false; await wait(300); } return true; }
  function sidOf(col, btn){
    const td = btn.closest("td"); if(!td) return "";
    if(col.sidAttr) return String(td.dataset[col.sidAttr] || "");
    const tr = btn.closest("tr"); const b = tr && tr.querySelector("td[data-cmp-brief-sid]");
    return String((b && b.dataset.cmpBriefSid) || (tr && tr.dataset.sid) || "");
  }
  function findBtn(col, sid){
    for(const b of document.querySelectorAll("#cmpBody " + col.sel)) if(sidOf(col, b) === sid && b.offsetParent !== null) return b;
    return null;
  }
  function pending(col){
    const out = [];
    for(const b of document.querySelectorAll("#cmpBody " + col.sel)){
      if(b.offsetParent === null) continue;
      const tr = b.closest("tr"), sid = sidOf(col, b);
      if(!sid || !tr) continue;
      const cs = (tr.querySelector("td") && tr.querySelector("td").innerText || "").split("\n")[0].trim();
      const route = (tr.children[1] && tr.children[1].innerText || "").split("\n")[0].trim();
      out.push({sid, label: cs + (route ? " " + route : ""), detail: b.dataset.tip || b.title || b.textContent || "", on: true});
    }
    return cmpBatchPick(out);
  }
  function paintHeads(){
    const tbl = document.getElementById("cmpBody") && document.getElementById("cmpBody").closest("table");
    if(!tbl) return;
    for(const th of tbl.querySelectorAll("thead th")){
      const txt = (th.firstChild && th.firstChild.nodeType === 3 ? th.firstChild.textContent : th.innerText).trim().toUpperCase();
      const col = COLS.find(c => c.head.test(txt));
      if(!col) continue;
      let b = th.querySelector(".cmp-batch-btn");
      if(!b){
        b = document.createElement("button"); b.type = "button"; b.className = "cmp-batch-btn";
        b.onclick = ev => { ev.stopPropagation(); ev.preventDefault(); cmpBatchOpen(col); };
        th.appendChild(b);
      }
      const n = running ? 0 : pending(col).length;
      const t = "Tất cả (" + n + ")";
      if(b.textContent !== t) b.textContent = t;
      b.disabled = running || !n;
      b.title = col.name + " cho mọi chuyến đang chờ trong bộ lọc hiện tại";
    }
  }
  async function execOne(col, it){
    const btn = findBtn(col, it.sid);
    if(!btn) return {ok:false, note:"Ô đã thay đổi hoặc không còn chờ"};
    if(col.key === "crew" || col.key === "fpl" || col.key === "aims"){
      btn.click(); await wait(50); await until(() => !cmpSyncBusy);
      await wait(200);
      const again = findBtn(col, it.sid);
      return {ok: !again};
    }
    if(col.key === "req"){
      await btn.onclick({stopPropagation(){}, preventDefault(){}});
      return {ok: !findBtn(col, it.sid)};
    }
    if(col.key === "brief"){
      btn.click(); await wait(50);
      await until(() => !btn.disabled || btn.classList.contains("done") || (typeof bsJob !== "undefined" && bsJob));
      await until(() => typeof bsJob === "undefined" || !bsJob);
      await wait(200);
      return {ok: btn.classList.contains("done")};
    }
    if(col.key === "verify"){
      if(typeof vfCmpJob !== "undefined" && vfCmpJob) await until(() => !vfCmpJob);
      const ow = window.write, fails = [];
      let ended = null;
      window.write = function(text, cls){
        const t = String(text || "");
        if(/^■ verify /.test(t)) ended = !/ lỗi\b/.test(t);
        else if(cls === "fail" || /^✗/.test(t)) fails.push(t.replace(/^✗\s*/, ""));
        return ow.apply(this, arguments);
      };
      let ok = false;
      try{
        btn.click();
        ok = await cmpVerifyWait(() => ({
          job: typeof vfCmpJob !== "undefined" && !!vfCmpJob,
          busy: btn.isConnected && (btn.disabled || btn.textContent === "…"),
          done: btn.classList.contains("done"),
          ended: ended === true,
        }), wait);
      }finally{ window.write = ow; }
      await wait(200);
      if(ended === false) ok = false;
      const note = ok ? "" : (fails.slice(-3).join(" · ") || (ended === false ? "FliteBrief báo lỗi khi verify" : "Không thấy kết quả verify"));
      return {ok, note};
    }
    if(col.key === "msg"){
      const td = btn.closest("td"), menu = td && td.querySelector("select.cmp-message-select");
      btn.click(); await wait(50);
      await until(() => !menu || !menu.disabled, 120000);
      return {ok:true};
    }
    return {ok:false, note:"Không hỗ trợ"};
  }
  function cmpBatchOpen(col){
    if(running || document.getElementById("cmpBatchModal")) return;
    const items = pending(col);
    if(!items.length) return;
    const focusBack = document.activeElement;
    const icon = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
    const checkIcon = icon('<path d="m5 12 4 4L19 6"/>');
    const closeIcon = icon('<path d="m6 6 12 12M18 6 6 18"/>');
    const listIcon = icon('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>');
    const m = document.createElement("div"); m.id = "cmpBatchModal";
    m.innerHTML = '<div class="bx" role="dialog" aria-modal="true" aria-labelledby="cmpBatchTitle"><div class="hd"><span class="hi">' + listIcon + '</span><div class="ht"><h2 id="cmpBatchTitle"></h2><div class="sub"></div></div><button type="button" class="btn icon" data-close aria-label="Đóng" title="Đóng">' + closeIcon + '</button></div><div class="tb"><label class="all"><input type="checkbox" data-all aria-label="Chọn tất cả chuyến"><span>Chọn tất cả</span></label><span class="ct" aria-live="polite"></span></div><div class="ls"></div><div class="ac" hidden><strong></strong><button type="button" class="btn ack" data-ack-confirm>' + checkIcon + 'Xác nhận Ack</button><button type="button" class="btn icon" data-ack-cancel aria-label="Huỷ Ack" title="Huỷ Ack">' + closeIcon + '</button></div><div class="ft"><div class="pg" role="status"></div><button type="button" class="btn ack" data-ack title="Ack các chuyến đã tick, không chạy thao tác">' + checkIcon + 'Ack all</button><button type="button" class="btn" data-x>Đóng</button><button type="button" class="btn primary" data-go>' + checkIcon + '<span></span></button></div></div>';
    m.querySelector("h2").textContent = col.name;
    const ls = m.querySelector(".ls");
    const all = m.querySelector("[data-all]"), go = m.querySelector("[data-go]"), ack = m.querySelector("[data-ack]");
    const ac = m.querySelector(".ac"), pg = m.querySelector(".pg");
    const actionNames = {crew:"Đổi crew", aims:"Đổi tàu", req:"Xuất REQ", msg:"Soạn điện văn", brief:"Đổi briefing", verify:"Verify"};
    go.querySelector("span").textContent = actionNames[col.key] || col.name;
    if(col.key === "verify") ack.remove();
    function update(){
      const chosen = cmpBatchPick(items).length;
      all.checked = items.length > 0 && chosen === items.length;
      all.indeterminate = chosen > 0 && chosen < items.length;
      all.disabled = running || !items.length;
      go.disabled = running || !chosen;
      ack.disabled = running || !chosen;
      m.querySelector(".sub").textContent = items.length + " chuyến đang chờ";
      m.querySelector(".ct").textContent = "Đã chọn " + chosen + " / " + items.length + " chuyến";
      items.forEach(it => { if(it._el) it._el.classList.toggle("selected", it.on !== false); });
      ac.hidden = true;
    }
    items.forEach(it => {
      const l = document.createElement("label"); l.className = "row selected";
      const c = document.createElement("input"); c.type = "checkbox"; c.checked = true; c.setAttribute("aria-label", "Chọn " + it.label);
      c.title = "Chọn chuyến — kéo lên/xuống để chọn nhiều chuyến";
      c.onchange = () => { it.on = c.checked; update(); };
      const fl = document.createElement("span"); fl.className = "fl";
      const b = document.createElement("b"), rt = document.createElement("span"); rt.className = "rt";
      const space = it.label.indexOf(" "); b.textContent = space < 0 ? it.label : it.label.slice(0, space); rt.textContent = space < 0 ? "" : it.label.slice(space + 1);
      fl.append(b, rt);
      const d = document.createElement("span"); d.className = "dt"; d.textContent = it.detail;
      l.append(c, fl, d); it._el = l; ls.appendChild(l);
    });
    document.body.appendChild(m);
    let drag = null, skipClick = false, scrollFrame = 0;
    function applyDrag(end){
      const states = cmpBatchDragSelection(drag.original, drag.start, end, drag.state);
      items.forEach((it, i) => { it.on = states[i]; it._el.querySelector("input").checked = states[i]; });
      update();
    }
    function hitDrag(){
      if(!drag) return;
      const row = document.elementFromPoint(drag.x, drag.y)?.closest("#cmpBatchModal .row");
      const i = items.findIndex(it => it._el === row);
      if(i >= 0) applyDrag(i);
    }
    function autoScroll(){
      if(!drag) return;
      const bounds = ls.getBoundingClientRect();
      const step = drag.y < bounds.top + 30 ? -10 : drag.y > bounds.bottom - 30 ? 10 : 0;
      if(step){ ls.scrollTop += step; hitDrag(); }
      scrollFrame = requestAnimationFrame(autoScroll);
    }
    function move(ev){ if(!drag) return; ev.preventDefault(); drag.x = ev.clientX; drag.y = ev.clientY; hitDrag(); }
    function endDrag(){
      drag = null; m.classList.remove("dragging"); cancelAnimationFrame(scrollFrame);
      setTimeout(() => { skipClick = false; }, 0);
    }
    ls.addEventListener("pointerdown", ev => {
      if(running || ev.button !== 0 || !ev.target.matches('input[type="checkbox"]')) return;
      const start = items.findIndex(it => it._el === ev.target.closest(".row"));
      if(start < 0) return;
      ev.preventDefault(); ev.target.focus();
      drag = {start, original:items.map(it => it.on !== false), state:!ev.target.checked, x:ev.clientX, y:ev.clientY};
      skipClick = true; m.classList.add("dragging"); applyDrag(start); autoScroll();
    });
    ls.addEventListener("click", ev => { if(skipClick){ ev.preventDefault(); ev.stopPropagation(); } }, true);
    document.addEventListener("pointermove", move, {passive:false});
    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
    function keydown(ev){
      if(ev.key === "Escape" && !running){ ev.preventDefault(); close(); return; }
      if(ev.key !== "Tab") return;
      const buttons = [...m.querySelectorAll('button:not(:disabled),input:not(:disabled)')].filter(el => el.offsetParent !== null);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if(ev.shiftKey && document.activeElement === first){ ev.preventDefault(); last?.focus(); }
      else if(!ev.shiftKey && document.activeElement === last){ ev.preventDefault(); first?.focus(); }
    }
    const close = () => {
      if(running) return;
      endDrag(); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", endDrag); document.removeEventListener("pointercancel", endDrag); document.removeEventListener("keydown", keydown);
      m.remove(); if(focusBack && focusBack.isConnected) focusBack.focus();
    };
    document.addEventListener("keydown", keydown);
    m.querySelector("[data-x]").onclick = () => { if(!running) close(); };
    m.querySelector("[data-close]").onclick = close;
    all.onchange = () => { items.forEach(it => { it.on = all.checked; it._el.querySelector("input").checked = all.checked; }); update(); };
    ack.onclick = () => { if(running || col.key === "verify" || !cmpBatchPick(items).length) return; ac.querySelector("strong").textContent = "Ack " + cmpBatchPick(items).length + " chuyến đã chọn?"; ac.hidden = false; m.querySelector("[data-ack-confirm]").focus(); };
    m.querySelector("[data-ack-cancel]").onclick = () => { ac.hidden = true; ack.focus(); };
    m.querySelector("[data-ack-confirm]").onclick = () => {
      if(running || col.key === "verify") return;
      const results = cmpBatchAck(col.key, items, sid => {
        const btn = findBtn(col, sid);
        if(!btn || typeof btn._cmpAck !== "function") return false;
        btn._cmpAck(); return true;
      });
      const done = new Set(results.filter(r => r.ok).map(r => r.sid));
      for(let i = items.length - 1; i >= 0; i--){ const it = items[i]; if(done.has(it.sid)){ it._el.remove(); items.splice(i, 1); } }
      results.filter(r => !r.ok).forEach(r => { const it = items.find(i => i.sid === r.sid); if(it){ const dt = it._el.querySelector(".dt"); dt.className = "dt bad"; dt.textContent = r.note; } });
      pg.textContent = "Đã Ack " + done.size + "/" + results.length + " chuyến" + (done.size < results.length ? " · Còn cảnh báo chưa Ack" : "");
      update(); paintHeads();
      if(!items.length){ ls.innerHTML = '<div class="empty">' + checkIcon + '<span></span></div>'; ls.querySelector(".empty span").textContent = "Đã Ack " + done.size + " chuyến"; ack.remove(); go.remove(); }
      m.querySelector("[data-x]").focus();
    };
    update(); m.querySelector("[data-close]").focus();
    go.onclick = async () => {
      const x = m.querySelector("[data-x]"), topClose = m.querySelector("[data-close]");
      const chosen = cmpBatchPick(items);
      if(running || !chosen.length) return;
      endDrag(); running = true; update(); x.disabled = true; topClose.disabled = true;
      ls.querySelectorAll("input").forEach(i => { i.disabled = true; });
      pg.innerHTML = '<span></span><div class="bar"><i></i></div>';
      const oc = window.confirm, oa = window.alert, ofr = window.ftOpenAtcReview;
      let notes = [], reviews = [];
      window.confirm = () => true;
      window.alert = msg => { notes.push(String(msg || "")); };
      if(col.key === "msg" && typeof ftOpenAtcReview === "function") window.ftOpenAtcReview = d => { reviews.push(d); };
      paintHeads();
      let results = [];
      try{
        results = await cmpBatchRun(chosen, async it => {
          notes = [];
          const r = await execOne(col, it);
          if(notes.length && !r.note) r.note = notes.join(" · ");
          if(notes.length && col.key !== "crew" && col.key !== "fpl" && col.key !== "aims") r.ok = r.ok && !notes.length;
          const el = it._el && it._el.querySelector(".dt");
          if(el){ el.className = "dt " + (r.ok ? "ok" : "bad"); el.textContent = (r.ok ? "✓ Xong" : "✗ " + (r.note || "Chưa xong")) ; }
          return r;
        }, (i, n, it) => {
          pg.querySelector("span").textContent = (i < n ? (i + 1) + "/" + n + " đang chạy… " + it.label : "Hoàn tất " + n + "/" + n);
          pg.querySelector("i").style.width = Math.round(i / n * 100) + "%";
        });
      }finally{
        window.confirm = oc; window.alert = oa;
        if(col.key === "msg") window.ftOpenAtcReview = ofr;
        running = false;
      }
      const ok = results.filter(r => r.ok).length;
      pg.querySelector("span").textContent = "Xong " + ok + "/" + results.length + (ok < results.length ? " · " + (results.length - ok) + " chuyến lỗi" : "");
      x.disabled = false; topClose.disabled = false; x.textContent = "Đóng"; go.remove(); ack.remove();
      if(col.key === "msg" && reviews.length && typeof ofr === "function"){
        const kinds = [...new Set(reviews.map(d => d.kind).filter(Boolean))];
        ofr({...reviews[reviews.length - 1], kind: kinds.length === 1 ? kinds[0] : "CHG/DLA", flights: reviews.flatMap(d => d.flights || [])});
      }
      paintHeads();
    };
  }
  const st = document.createElement("style"); st.textContent = ${'`'}__CSS__${'`'}; document.head.appendChild(st);
  setInterval(() => { if(!document.hidden) paintHeads(); }, 1500);
  window.cmpBatchOpen = cmpBatchOpen;
})();
`;

export function patchCmpBatchPage(html: string): string {
  if (html.includes('id="cmpBatchScript"')) return html;
  const js = SCRIPT
    .replace('__PICK__', () => cmpBatchPick.toString())
    .replace('__DRAG__', () => cmpBatchDragSelection.toString())
    .replace('__ACK__', () => cmpBatchAck.toString())
    .replace('__RUN__', () => cmpBatchRun.toString())
    .replace('__VWAIT__', () => cmpVerifyWait.toString())
    .replace('__CSS__', () => CSS);
  const idx = html.lastIndexOf('</body>');
  const tag = '<script id="cmpBatchScript">' + js + '</script>';
  return idx >= 0 ? html.slice(0, idx) + tag + html.slice(idx) : html + tag;
}
