// Compare tab batch actions: a header button per action column runs every
// pending cell of that column one after another, after a single confirmation.
// Each flight still goes through its own existing handler and checks.

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

const CSS = `
html body table.cmptbl thead tr th button.cmp-batch-btn.cmp-batch-btn{display:block;margin:3px auto 0;padding:1px 7px!important;border-radius:6px;border:1px solid #fff!important;background:#fff!important;color:#e31937!important;-webkit-text-fill-color:#e31937!important;font-size:10px!important;line-height:16px!important;min-height:0!important;height:auto!important;font-weight:800;letter-spacing:0;cursor:pointer;white-space:nowrap;text-transform:none}
html body table.cmptbl thead tr th button.cmp-batch-btn.cmp-batch-btn:disabled{opacity:.35;cursor:default}
#cmpBatchModal{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--x-ink,#111) 50%,transparent)}
#cmpBatchModal .bx{background:var(--x-card,#fff);color:var(--x-ink,#111);border-radius:12px;width:min(640px,94vw);max-height:84vh;display:flex;flex-direction:column;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden}
#cmpBatchModal .hd{background:var(--x-red,#e31937);color:var(--x-card,#fff);padding:12px 16px;font-weight:800;font-size:15px}
#cmpBatchModal .ls{overflow:auto;padding:8px 12px;flex:1}
#cmpBatchModal label{display:flex;gap:10px;align-items:flex-start;padding:7px 6px;border-bottom:1px solid var(--x-line,#e5e7eb);font-size:13px;cursor:pointer}
#cmpBatchModal label b{min-width:90px}
#cmpBatchModal .dt{color:var(--x-muted,#555);font-family:ui-monospace,monospace;font-size:12px;word-break:break-word}
#cmpBatchModal .ft{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:10px 14px;border-top:1px solid var(--x-line,#e5e7eb)}
#cmpBatchModal .pg{flex:1;font-size:12px;font-weight:700}
#cmpBatchModal .bar{height:6px;background:var(--x-line,#e5e7eb);border-radius:4px;overflow:hidden;margin-top:4px}
#cmpBatchModal .bar i{display:block;height:100%;width:0;background:var(--x-red,#e31937);transition:width .2s}
#cmpBatchModal .ok{color:#16a34a;font-weight:800}
#cmpBatchModal .bad{color:var(--x-red,#e31937);font-weight:800}
`;

const SCRIPT = String.raw`
(function(){
  const cmpBatchPick = __PICK__;
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
    if(running) return;
    const items = pending(col);
    if(!items.length) return;
    const m = document.createElement("div"); m.id = "cmpBatchModal";
    m.innerHTML = '<div class="bx" role="dialog" aria-modal="true"><div class="hd"></div><div class="ls"></div><div class="ft"><div class="pg"></div><button type="button" class="btn small" data-x>Huỷ</button><button type="button" class="btn primary" data-go>Đồng ý</button></div></div>';
    m.querySelector(".hd").textContent = col.name + " · " + items.length + " chuyến";
    const ls = m.querySelector(".ls");
    items.forEach(it => {
      const l = document.createElement("label");
      const c = document.createElement("input"); c.type = "checkbox"; c.checked = true; c.onchange = () => { it.on = c.checked; };
      const b = document.createElement("b"); b.textContent = it.label;
      const d = document.createElement("span"); d.className = "dt"; d.textContent = it.detail;
      l.append(c, b, d); it._el = l; ls.appendChild(l);
    });
    document.body.appendChild(m);
    const close = () => m.remove();
    m.querySelector("[data-x]").onclick = () => { if(!running) close(); };
    m.addEventListener("click", ev => { if(ev.target === m && !running) close(); });
    m.querySelector("[data-go]").onclick = async () => {
      const go = m.querySelector("[data-go]"), x = m.querySelector("[data-x]"), pg = m.querySelector(".pg");
      const chosen = cmpBatchPick(items);
      if(!chosen.length){ close(); return; }
      running = true; go.disabled = true; x.disabled = true;
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
      x.disabled = false; x.textContent = "Đóng"; go.remove();
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
    .replace('__RUN__', () => cmpBatchRun.toString())
    .replace('__VWAIT__', () => cmpVerifyWait.toString())
    .replace('__CSS__', () => CSS);
  const idx = html.lastIndexOf('</body>');
  const tag = '<script id="cmpBatchScript">' + js + '</script>';
  return idx >= 0 ? html.slice(0, idx) + tag + html.slice(idx) : html + tag;
}
