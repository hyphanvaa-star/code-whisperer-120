import styles from '@/styles.css?raw';

export type NotamDetail = { loc: string; id: string; text: string; level?: string; reasons?: string[] };

/** Self-contained for injection; retain the actual PDF text, not a reconstructed NOTAM. */
export function bpPackDetails(text: string): NotamDetail[] {
  const raw = String(text || '');
  const re = /\b([A-Z]{4}):\s+(?:APT|FIR)\s+\d{10}\s+([A-Z]\d{4}\/\d{2})\b/g;
  const headers = [...raw.matchAll(re)];
  const out: NotamDetail[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const body = raw.slice(h.index, headers[i + 1]?.index ?? raw.length).trim();
    const found = out.find(n => n.loc === h[1] && n.id === h[2]);
    if (!found) out.push({ loc: h[1], id: h[2], text: body });
    else if (body.length > found.text.length) found.text = body;
  }
  return out;
}

/** Resolve all collections without mixing same-number NOTAMs from different locations. */
export function bpNotamDetails(places: any[], wanted: {loc?: string; id: string}[]): NotamDetail[] {
  const out: NotamDetail[] = [];
  for (const w of wanted) {
    let found = false;
    for (const p of places || []) {
      const loc = String(p.code || '').toUpperCase();
      if (w.loc && loc !== w.loc.toUpperCase()) continue;
      const rows = [...(p.notams || []), ...(p.dropped || []), ...(p.notams_src || [])];
      const candidates = rows.filter(n => String(n.ident || '').toUpperCase().match(/[A-Z]\d{4}\/\d{2}/)?.[0] === w.id.toUpperCase());
      if (!candidates.length) continue;
      const n = candidates.find(n => n.text || n.e_field) || candidates[0];
      if (!out.some(n => n.loc === loc && n.id === w.id)) out.push({ loc, id: w.id, text: String(n.text || n.e_field || ''), level: candidates.find(n => n.level)?.level, reasons: candidates.find(n => n.reasons?.length)?.reasons || [] });
      found = true;
    }
    if (!found) out.push({ loc: w.loc || '', id: w.id, text: '' });
  }
  return out;
}


/** PDF page furniture (headers, weather, page refs) that interleaves NOTAM bodies. */
export function bpCleanText(text: string): string {
  const junk = [/^NOT FOR OPERATIONAL USE$/i, /^En-?Route Data$/i, /^Ref:\s*OPS GEN\.?\s*\d+\/\d+$/i,
    /^Airfield (?:Weather|NOTAM) Information$/i, /^ICAO Class\b.*$/i, /^[MT]:\s*\d{6}Z\b.*=?$/,
    /^[A-Z]{4}\s*\[[A-Z]{3}\]\s.*\bERA$/i, /^Page \d+( of \d+)?$/i];
  const lines = String(text || '').replace(/\r/g, '').split('\n')
    .map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(l => l && !junk.some(r => r.test(l)));
  const out: string[] = [];
  for (const l of lines) {
    const prev = out[out.length - 1];
    // Re-join wrapped body lines; keep a new line for each ICAO field (Q) A) … G)).
    if (prev !== undefined && !/^[QABCDEFG]\)/.test(l) && !/^[A-Z]{4}:\s/.test(l) && !/^RMK:/i.test(l) && !/[.=]$/.test(prev)) out[out.length - 1] = prev + ' ' + l;
    else out.push(l);
  }
  return out.join('\n');
}

export type NotamFields = { q: string; a: string; b: string; c: string; d: string; e: string; f: string; g: string; est: boolean; perm: boolean };
/** Split an ICAO NOTAM into its lettered fields, wherever they sit on a line. */
export function bpFields(text: string): NotamFields {
  const t = String(text || '');
  const out: NotamFields = { q: '', a: '', b: '', c: '', d: '', e: '', f: '', g: '', est: false, perm: false };
  const re = /(?:^|\s)([QABCDEFG])\)\s*/g;
  const marks = [...t.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i]; const k = m[1].toLowerCase() as 'q';
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? t.length;
    if (!out[k]) out[k] = t.slice(start, end).replace(/\s+/g, ' ').trim();
  }
  out.est = /\bEST\b/.test(out.c); out.perm = /\bPERM\b/.test(out.c);
  out.c = out.c.replace(/[-\s]*\b(EST|PERM)\b/, '').trim();
  return out;
}

/** "2611042300" → "04/11 23:00Z"; anything else is returned untouched. */
export function bpZ(v: string): string {
  const raw = String(v || '').trim();
  const m = (/^\d{12}/.test(raw) ? raw.slice(2) : raw).match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  return m ? m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5] + 'Z' : String(v || '');
}

/** Acknowledgement must not consume NOTAMs that arrived after the dialog opened. */
export function bpUnseenAfter(current: {ids: string[]; [key: string]: unknown} | null, seen: string[]) {
  if (!current) return null;
  const acknowledged = new Set(seen);
  const ids = current.ids.filter(id => !acknowledged.has(id));
  return ids.length ? { ...current, ids } : null;
}

export function patchNotamChangePopupPage(html: string): string {
  const tokens = (styles.match(/^  --crew-hover-[^\n]+/gm) || []).join('\n');
  return html
    .replace('  function uid(){ try{ for(const k of Object.keys(localStorage))', `
  const bpPackDetails = ${bpPackDetails.toString()};
  const bpNotamDetails = ${bpNotamDetails.toString()};
  const bpUnseenAfter = ${bpUnseenAfter.toString()};
  const bpCleanText = ${bpCleanText.toString()};
  const bpFields = ${bpFields.toString()};
  const bpZ = ${bpZ.toString()};
  const bpDetailData = {};
  function bpPopup(fid, kind){
    const old = document.getElementById("bpDetailDialog"); if(old) old.close();
    const state = get(K(kind === "missing" ? "bpcmp" : "new", fid)) || {};
    const seen = [...(state.ids || [])];
    const data = bpDetailData[fid] || (typeof nmTrackCache !== "undefined" && nmTrackCache[fid]) || {};
    const wanted = kind === "missing" ? (state.missing || []) : seen.map(id => ({id}));
    const stored = state.details || [];
    const fresh = bpNotamDetails(data.places || [], wanted);
    const rows = kind === "missing" ? wanted.map(w => stored.find(n => n.loc === w.loc && n.id === w.id) || {...w,text:""}) : (data.places ? fresh.map(n => stored.find(s => s.id === n.id && s.loc === n.loc) || n) : wanted.flatMap(w => {const matches=stored.filter(n=>n.id===w.id);return matches.length?matches:[{id:w.id,loc:"",text:""}];}));
    const fl = data.flight || {};
    const cs = String(fl.callsign || "").toUpperCase();
    const hhmm = v => { const d = new Date(v); return isNaN(d) ? "" : String(d.getUTCDate()).padStart(2,"0") + "/" + String(d.getUTCMonth()+1).padStart(2,"0") + " " + String(d.getUTCHours()).padStart(2,"0") + ":" + String(d.getUTCMinutes()).padStart(2,"0") + "Z"; };
    const roleOf = loc => {
      const L = String(loc || "").toUpperCase(); if(!L) return "";
      for(const p of (data.places || [])){ if(String(p.code||"").toUpperCase() !== L) continue;
        const u = (p.uses || []).find(u => String(u.cs||"").toUpperCase() === cs); if(u && u.role) return String(u.role).toUpperCase();
        if(p.kind === "F" || p.kind === "FIR") return "FIR"; }
      if(L === String(fl.dep||"").toUpperCase()) return "DEP";
      if(L === String(fl.dest||"").toUpperCase()) return "ARR";
      return "";
    };
    const node = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls; if(text)el.textContent=text; return el; };
    const dialog = node("dialog", "bp-detail"); dialog.id = "bpDetailDialog";
    dialog.setAttribute("aria-labelledby", "bpDetailTitle");
    function button(text, title, action, extra){const b=node("button","bp-btn" + (extra ? " " + extra : ""),text);b.type="button";b.title=title;b.setAttribute("aria-label",title);b.onclick=action;return b;}
    const head = node("header", "bp-detail-head");
    const heading = node("div", "bp-head-main");
    const title = node("h2", "bp-title", kind === "missing" ? "NOTAM có trong Briefing pack nhưng Web chưa có" : "NOTAM mới trước giờ bay · T−60"); title.id="bpDetailTitle";
    const flightRow = node("div", "bp-flight");
    flightRow.append(node("span", "bp-flight-cs", cs || label(fid)));
    if(fl.dep || fl.dest) flightRow.append(node("span", "bp-flight-route", (fl.dep || "?") + " → " + (fl.dest || "?")));
    if(fl.std) flightRow.append(node("span", "bp-flight-time", "STD " + hhmm(fl.std)));
    if(fl.sta) flightRow.append(node("span", "bp-flight-time", "STA " + hhmm(fl.sta)));
    if(fl.reg) flightRow.append(node("span", "bp-flight-time", fl.reg));
    const crit = rows.filter(n => n.level === "CRITICAL").length;
    const stats = node("div", "bp-stats");
    stats.append(node("span", "bp-stat", rows.length + " NOTAM"));
    if(crit) stats.append(node("span", "bp-stat bp-stat-crit", crit + " CRITICAL"));
    heading.append(flightRow, title, stats); head.append(heading);
    head.append(button("✕", "Đóng danh sách NOTAM", () => dialog.close(), "bp-btn-icon"));
    const status = node("div", "bp-detail-status"); status.setAttribute("role","status");
    async function copy(text){
      try{ await navigator.clipboard.writeText(text); status.textContent="Đã sao chép"; }
      catch(e){const ta=node("textarea","bp-detail-copy");ta.value=text;dialog.append(ta);ta.select();const ok=document.execCommand("copy");ta.remove();status.textContent=ok?"Đã sao chép":"Không sao chép được; hãy chọn nội dung và sao chép thủ công.";}
    }
    const clean = n => bpCleanText(n.text || "");
    const full = n => [n.loc + " " + n.id,n.level,(n.reasons || []).join(" · "),clean(n) || "Chưa có nội dung NOTAM trong dữ liệu đã lưu."].filter(Boolean).join("\\n");
    const AIK = "bp.ai:";
    const md = s => { const esc = String(s||"").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"})[c]);
      return esc.split("\\n").map(l => { l = l.replace(/\\*\\*(.+?)\\*\\*/g, "<b>$1</b>");
        if(/^#{1,4}\\s/.test(l)) return "<div class=\\"bp-ai-h\\">" + l.replace(/^#+\\s*/, "") + "</div>";
        if(/^\\s*[-*•]\\s/.test(l)) return "<div class=\\"bp-ai-li\\">" + l.replace(/^\\s*[-*•]\\s/, "") + "</div>";
        return l.trim() ? "<div>" + l + "</div>" : ""; }).join(""); };
    async function decode(n, box, b){
      const key = AIK + n.loc + ":" + n.id;
      const hit = sessionStorage.getItem(key);
      box.hidden = false;
      if(hit){ box.innerHTML = md(hit); return; }
      if(b) b.disabled = true; box.textContent = "AI đang giải mã…";
      try{
        const r = await fetch("/api/notam/decode", {method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({text: clean(n), loc: n.loc, id: n.id, role: roleOf(n.loc), flight: {cs, dep: fl.dep || "", dest: fl.dest || "", std: fl.std || "", sta: fl.sta || ""}})});
        const d = await r.json();
        if(!r.ok || d.error) throw Error(d.error || ("Lỗi " + r.status));
        sessionStorage.setItem(key, d.content || "");
        box.innerHTML = md(d.content || "");
      }catch(e){ box.textContent = "Không giải mã được: " + String(e.message || e); }
      finally{ if(b) b.disabled = false; }
    }
    const bar=node("div","bp-detail-bar");
    const aiAll = [];
    bar.append(button("✦ AI giải mã tất cả", "AI giải mã toàn bộ NOTAM", async ev => { const b = ev.currentTarget; b.disabled = true; for(const f of aiAll) await f(); b.disabled = false; }, "bp-btn-ai"),
      button("Sao chép số hiệu", "Sao chép danh sách số hiệu", () => copy(rows.map(n => [n.loc,n.id].filter(Boolean).join(" ")).join("\\n"))),
      button("Sao chép nội dung", "Sao chép đầy đủ nội dung", () => copy(rows.map(full).join("\\n\\n"))));
    if(kind === "missing")bar.append(button("↻ So lại", "So lại với FliteBrief", async ev => {
      const b=ev.currentTarget;b.disabled=true;status.textContent="Đang đọc Briefing pack…";
      try{if(!nmTrackCache[fid]){const r=await fetch("/api/notam/track?id="+encodeURIComponent(fid)+"&days=2");const d=await r.json();if(!r.ok || !d || d.error)throw Error(d && d.error || "Không tải được dữ liệu chuyến");nmTrackCache[fid]=d;}await autoPack(fid,true);const c=get(K("bpcmp",fid));if(c && c.err){status.textContent=c.err;return;}dialog.close();bpPopup(fid,kind);}catch(e){status.textContent=String(e.message || e);}finally{b.disabled=false;}
    }));
    else bar.append(button("✓ Đã xem", "Đánh dấu đã xem", () => {set(K("new",fid),bpUnseenAfter(get(K("new",fid)),seen));refill();dialog.close();}, "bp-btn-ok"));
    const list=node("div","bp-detail-list");
    for(const n of rows){
      const item=node("article","bp-card" + (n.level === "CRITICAL" ? " bp-card-crit" : ""));
      const f = bpFields(clean(n));
      const top=node("div","bp-card-head");
      top.append(node("span","bp-loc",n.loc || "—"));
      const role = roleOf(n.loc); if(role) top.append(node("span","bp-role bp-role-" + role.replace(/[^A-Z]/g,"").toLowerCase(), role));
      top.append(node("strong","bp-ident",n.id));
      if(n.level) top.append(node("span","bp-level" + (n.level === "CRITICAL" ? " crit" : n.level === "NO IMPACT" ? " none" : ""), n.level));
      const acts = node("div","bp-card-acts");
      const aiBox = node("div","bp-ai"); aiBox.hidden = true;
      const aiBtn = button("✦ AI giải mã", "AI giải mã " + n.id, ev => decode(n, aiBox, ev.currentTarget), "bp-btn-ai bp-btn-sm");
      if(clean(n)){ acts.append(aiBtn); aiAll.push(() => decode(n, aiBox, aiBtn)); }
      acts.append(button("Sao chép", "Sao chép " + n.id, () => copy(full(n)), "bp-btn-sm"));
      if(kind === "new" && n.loc && n.text) acts.append(button("⌖ Bản đồ", "Xem " + n.id + " trên bản đồ", async ev => {
        const b=ev.currentTarget;b.disabled=true;
        try{let d=bpDetailData[fid] || nmTrackCache[fid];if(!d){const r=await fetch("/api/notam/track?id="+encodeURIComponent(fid)+"&days=2");d=await r.json();if(!r.ok || !d || d.error)throw Error(d && d.error || "Không tải được dữ liệu chuyến");}nmTrackCache[fid]=d;nmTrackShow(fid);nmShowNotam(n.loc,n.id,fid);dialog.close();}catch(e){status.textContent=String(e.message || e);}finally{b.disabled=false;}
      }, "bp-btn-sm"));
      top.append(acts); item.append(top);
      if(f.b || f.c){
        const when = node("div","bp-when");
        when.append(node("span","bp-k","Hiệu lực"), node("span","bp-v", bpZ(f.b) + "  →  " + (f.perm ? "PERM" : bpZ(f.c) + (f.est ? " (EST)" : ""))));
        if(f.d){ when.append(node("span","bp-k","Lịch (D)"), node("span","bp-v", f.d)); }
        item.append(when);
      }
      if(n.reasons && n.reasons.length) item.append(node("div","bp-reasons",n.reasons.join(" · ")));
      if(f.e) item.append(node("div","bp-e", f.e));
      if(f.f || f.g) item.append(node("div","bp-limits", "Giới hạn cao: " + (f.f || "SFC") + " → " + (f.g || "UNL")));
      item.append(aiBox);
      const raw = node("details","bp-raw"); raw.open = !f.e;
      raw.append(node("summary","", "Nguyên văn NOTAM"), node("pre","bp-raw-text", clean(n) || "Chưa có nội dung NOTAM trong dữ liệu đã lưu."));
      item.append(raw);
      list.append(item);
    }
    if(!rows.length)list.append(node("div","bp-detail-empty",kind === "missing" ? "Web đã có đủ NOTAM của Briefing pack." : "Không còn NOTAM mới chưa xem."));
    const foot=node("footer","bp-detail-foot");foot.append(status,button("Đóng","Đóng",()=>dialog.close()));
    dialog.append(head,bar,list,foot);document.body.append(dialog);
    dialog.addEventListener("close",()=>dialog.remove());
    dialog.addEventListener("click",ev=>{if(ev.target!==dialog)return;const r=dialog.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)dialog.close();});
    dialog.showModal();
  }
  function uid(){ try{ for(const k of Object.keys(localStorage))`)
    .replace('missing: res.missing });', 'missing: res.missing, details: bpPackDetails(text).filter(n => res.missing.some(m => m.loc === n.loc && m.id === n.id)) });')
    .replace('text += tc.items.map(t => t.str).join(" ") + "\\n";', 'text += tc.items.map(t => t.str + (t.hasEOL ? "\\n" : " ")).join("") + "\\n";')
    .replace('if(!(typeof nmTrackCache !== "undefined" && nmTrackCache[fid])){ alert(', 'if(c && !c.err && c.missing && c.missing.length){ bpPopup(fid,"missing"); return; } if(!(typeof nmTrackCache !== "undefined" && nmTrackCache[fid])){ alert(')
    .replace('set(K("new", fid), null); refill(); };', 'bpPopup(fid,"new"); };')
    .replace('set(K("new", fid), { ids: added, at: now });', 'bpDetailData[fid] = d; set(K("new", fid), { ids: added, at: now, details: bpNotamDetails(d.places || [], added.map(id => ({id}))) });')
    .replace('"\\n\\nBấm để so lại."; }', '"\\n\\nBấm để xem danh sách."; }')
    .replace('"\\n\\nBấm để đã xem";', '"\\n\\nBấm để xem danh sách";')
    .replace('s.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); if(c &&', 's.setAttribute("role","button"); s.tabIndex=0; s.onkeydown=ev=>{if(ev.key==="Enter" || ev.key===" "){ev.preventDefault();s.click();}}; s.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); if(c &&')
    .replace('b.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); };\n      b.onclick', 'b.setAttribute("role","button"); b.tabIndex=0; b.onkeydown=ev=>{if(ev.key==="Enter" || ev.key===" "){ev.preventDefault();b.click();}}; b.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); };\n      b.onclick')
    .replace('</head>', `<style>
:root{${tokens}}
dialog.bp-detail{box-sizing:border-box;width:min(980px,calc(100vw - 32px));max-width:calc(100vw - 32px);height:min(880px,90vh);max-height:90vh;margin:auto;padding:0;border:1px solid var(--crew-hover-line);border-radius:14px;background:var(--crew-hover-paper);color:var(--crew-hover-ink);box-shadow:var(--crew-hover-shadow);font:15px/1.55 Arial,sans-serif;letter-spacing:0;overflow:hidden}
dialog.bp-detail[open]{display:grid;grid-template-rows:auto auto minmax(0,1fr) auto}
dialog.bp-detail::backdrop{background:color-mix(in oklch,var(--crew-hover-ink) 50%,transparent)}
.bp-detail *{box-sizing:border-box}
.bp-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:18px 22px 14px;border-bottom:1px solid var(--crew-hover-line);border-top:4px solid var(--crew-hover-danger)}
.bp-head-main{min-width:0}
.bp-flight{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.bp-flight span{font:700 13px/1.3 ui-monospace,Consolas,monospace;padding:4px 9px;border-radius:999px;background:var(--crew-hover-flite-soft);color:var(--crew-hover-flite)}
.bp-detail .bp-flight .bp-flight-cs{background:var(--crew-hover-flite);color:var(--crew-hover-paper)}
.bp-detail .bp-title{margin:10px 0 6px;font:800 20px/1.3 Arial,sans-serif;color:var(--crew-hover-ink)}
.bp-stats{display:flex;gap:6px}
.bp-stat{font-size:12px;font-weight:800;padding:2px 8px;border-radius:4px;background:var(--crew-hover-line);color:var(--crew-hover-ink)}
.bp-stat-crit{background:var(--crew-hover-danger-soft);color:var(--crew-hover-danger)}
.bp-detail .bp-btn{flex-shrink:0;min-height:34px;white-space:nowrap;padding:6px 12px;border:1px solid var(--crew-hover-line);border-radius:8px;background:var(--crew-hover-paper);color:var(--crew-hover-ink);font:700 13px/1.3 Arial,sans-serif;cursor:pointer;box-shadow:none;text-transform:none}
.bp-detail .bp-btn:hover{background:var(--crew-hover-flite-soft);border-color:var(--crew-hover-flite)}
.bp-detail .bp-btn:focus-visible{outline:2px solid var(--crew-hover-flite);outline-offset:2px}
.bp-detail .bp-btn:disabled{opacity:.55;cursor:wait}
.bp-detail .bp-btn-icon{width:36px;padding:0}
.bp-detail .bp-btn-ai{background:var(--crew-hover-flite);border-color:var(--crew-hover-flite);color:var(--crew-hover-paper)}
.bp-detail .bp-btn-ai:hover{background:var(--crew-hover-ink);border-color:var(--crew-hover-ink)}
.bp-detail .bp-btn-ok{background:var(--crew-hover-excel);border-color:var(--crew-hover-excel);color:var(--crew-hover-paper)}
.bp-detail .bp-btn-sm{min-height:28px;padding:4px 10px;font-size:12px}
.bp-detail-bar{display:flex;gap:8px;flex-wrap:wrap;padding:10px 22px;background:var(--crew-hover-flite-soft);border-bottom:1px solid var(--crew-hover-line)}
.bp-detail-list{min-height:0;overflow:auto;padding:14px 22px 20px;display:flex;flex-direction:column;gap:12px;background:color-mix(in oklch,var(--crew-hover-line) 35%,var(--crew-hover-paper))}
.bp-card{flex-shrink:0;padding:14px 16px;border:1px solid var(--crew-hover-line);border-left:4px solid var(--crew-hover-flite);border-radius:10px;background:var(--crew-hover-paper)}
.bp-card-crit{border-left-color:var(--crew-hover-danger)}
.bp-card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bp-loc{font:800 13px/1.3 ui-monospace,Consolas,monospace;color:var(--crew-hover-paper);background:var(--crew-hover-ink);padding:3px 8px;border-radius:4px}
.bp-role{font:800 11px/1.3 Arial,sans-serif;padding:3px 7px;border-radius:4px;background:var(--crew-hover-flite-soft);color:var(--crew-hover-flite)}
.bp-role-dep,.bp-role-arr{background:var(--crew-hover-danger-soft);color:var(--crew-hover-danger)}
.bp-ident{font:800 18px/1.3 ui-monospace,Consolas,monospace}
.bp-level{font-size:11px;font-weight:800;padding:3px 7px;border-radius:4px;background:var(--crew-hover-flite-soft);color:var(--crew-hover-flite)}
.bp-level.crit{background:var(--crew-hover-danger);color:var(--crew-hover-paper)}
.bp-level.none{background:var(--crew-hover-line);color:var(--crew-hover-muted)}
.bp-card-acts{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.bp-when{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin-top:10px;font-size:13px}
.bp-k{color:var(--crew-hover-muted);font-weight:700}
.bp-v{font-family:ui-monospace,Consolas,monospace;font-weight:700;overflow-wrap:anywhere}
.bp-reasons{font-size:13px;color:var(--crew-hover-muted);margin-top:6px}
.bp-e{margin-top:10px;padding:10px 12px;border-radius:8px;background:var(--crew-hover-flite-soft);font:700 15px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.bp-card-crit .bp-e{background:var(--crew-hover-danger-soft)}
.bp-limits{margin-top:6px;font-size:12px;color:var(--crew-hover-muted);font-family:ui-monospace,Consolas,monospace}
.bp-ai{margin-top:10px;padding:10px 12px;border:1px dashed var(--crew-hover-flite);border-radius:8px;font-size:14px;line-height:1.6}
.bp-ai[hidden]{display:none}
.bp-ai-h{font-weight:800;color:var(--crew-hover-flite);margin-top:6px}
.bp-ai-li{padding-left:14px;position:relative}
.bp-ai-li::before{content:"•";position:absolute;left:2px;color:var(--crew-hover-flite)}
.bp-raw{margin-top:8px}
.bp-raw summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--crew-hover-muted)}
.bp-detail .bp-raw-text{margin:6px 0 0;padding:10px;border-radius:6px;background:color-mix(in oklch,var(--crew-hover-line) 40%,var(--crew-hover-paper));font:13px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:none;color:var(--crew-hover-ink)}
.bp-detail-foot{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:10px 22px;border-top:1px solid var(--crew-hover-line)}
.bp-detail-status{color:var(--crew-hover-excel);font-size:13px;overflow-wrap:anywhere}
.bp-detail-empty{padding:32px 0;color:var(--crew-hover-muted);text-align:center}
.bp-detail-copy{position:fixed;width:1px;height:1px;opacity:0}
@media(max-width:600px){dialog.bp-detail{width:calc(100vw - 12px);max-width:calc(100vw - 12px);height:94vh;max-height:94vh}.bp-detail-head,.bp-detail-bar,.bp-detail-foot{padding:10px 12px}.bp-detail-list{padding:10px 12px}.bp-card-acts{margin-left:0;width:100%}}
</style></head>`);
}