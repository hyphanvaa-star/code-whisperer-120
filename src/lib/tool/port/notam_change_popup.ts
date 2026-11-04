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
    const node = (tag, cls, text) => { const el = document.createElement(tag); el.className = cls; if(text)el.textContent=text; return el; };
    const dialog = node("dialog", "bp-detail"); dialog.id = "bpDetailDialog";
    dialog.setAttribute("aria-labelledby", "bpDetailTitle");
    const head = node("header", "bp-detail-head");
    const heading = node("div", "");
    heading.append(node("div", "bp-detail-eyebrow", label(fid) + " · " + rows.length + " NOTAM"));
    const title = node("h2", "", kind === "missing" ? "NOTAM trong Briefing pack mà Web chưa có" : "NOTAM mới trước giờ bay · T−60"); title.id="bpDetailTitle"; heading.append(title); head.append(heading);
    function button(text, title, action){const b=node("button","btn bp-detail-button",text);b.type="button";b.title=title;b.setAttribute("aria-label",title);b.onclick=action;return b;}
    head.append(button("×", "Đóng danh sách NOTAM", () => dialog.close()));
    const status = node("div", "bp-detail-status"); status.setAttribute("role","status");
    async function copy(text){
      try{ await navigator.clipboard.writeText(text); status.textContent="Đã sao chép"; }
      catch(e){const ta=node("textarea","bp-detail-copy");ta.value=text;dialog.append(ta);ta.select();const ok=document.execCommand("copy");ta.remove();status.textContent=ok?"Đã sao chép":"Không sao chép được; hãy chọn nội dung và sao chép thủ công.";}
    }
    const full = n => [n.loc + " " + n.id,n.level,(n.reasons || []).join(" · "),n.text || "Chưa có nội dung NOTAM trong dữ liệu đã lưu."].filter(Boolean).join("\\n");
    const bar=node("div","bp-detail-bar");
    bar.append(button("▣ Số hiệu", "Sao chép danh sách số hiệu", () => copy(rows.map(n => [n.loc,n.id].filter(Boolean).join(" ")).join("\\n"))),button("▣ Nội dung", "Sao chép đầy đủ nội dung", () => copy(rows.map(full).join("\\n\\n"))));
    if(kind === "missing")bar.append(button("↻ So lại", "So lại với FliteBrief", async ev => {
      const b=ev.currentTarget;b.disabled=true;status.textContent="Đang đọc Briefing pack…";
      try{if(!nmTrackCache[fid]){const r=await fetch("/api/notam/track?id="+encodeURIComponent(fid)+"&days=2");const d=await r.json();if(!r.ok || !d || d.error)throw Error(d && d.error || "Không tải được dữ liệu chuyến");nmTrackCache[fid]=d;}await autoPack(fid,true);const c=get(K("bpcmp",fid));if(c && c.err){status.textContent=c.err;return;}dialog.close();bpPopup(fid,kind);}catch(e){status.textContent=String(e.message || e);}finally{b.disabled=false;}
    }));
    else bar.append(button("✓ Đã xem", "Đánh dấu đã xem", () => {set(K("new",fid),bpUnseenAfter(get(K("new",fid)),seen));refill();dialog.close();}));
    const list=node("div","bp-detail-list");
    for(const n of rows){
      const item=node("article","bp-detail-item");
      const top=node("div","bp-detail-item-head");top.append(node("span","bp-detail-location",n.loc || "—"),node("strong","bp-detail-ident",n.id),button("▣", "Sao chép " + n.id, () => copy(full(n))));item.append(top);
      if(n.level)item.append(node("div","bp-detail-level" + (n.level === "CRITICAL" ? " critical" : ""),n.level));
      if(n.reasons && n.reasons.length)item.append(node("div","bp-detail-reasons",n.reasons.join(" · ")));
      item.append(node("pre","bp-detail-text",n.text || "Chưa có nội dung NOTAM trong dữ liệu đã lưu."));
      if(kind === "new" && n.loc && n.text)item.append(button("⌖ Bản đồ", "Xem " + n.id + " trên bản đồ", async ev => {
        const b=ev.currentTarget;b.disabled=true;
        try{let d=bpDetailData[fid] || nmTrackCache[fid];if(!d){const r=await fetch("/api/notam/track?id="+encodeURIComponent(fid)+"&days=2");d=await r.json();if(!r.ok || !d || d.error)throw Error(d && d.error || "Không tải được dữ liệu chuyến");}nmTrackCache[fid]=d;nmTrackShow(fid);nmShowNotam(n.loc,n.id,fid);dialog.close();}catch(e){status.textContent=String(e.message || e);}finally{b.disabled=false;}
      }));
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
    .replace('s.onmousedown = ev =>', 's.setAttribute("role","button"); s.tabIndex=0; s.onkeydown=ev=>{if(ev.key==="Enter" || ev.key===" "){ev.preventDefault();s.click();}}; s.onmousedown = ev =>')
    .replace('b.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); };\n      b.onclick', 'b.setAttribute("role","button"); b.tabIndex=0; b.onkeydown=ev=>{if(ev.key==="Enter" || ev.key===" "){ev.preventDefault();b.click();}}; b.onmousedown = ev => { ev.preventDefault(); ev.stopPropagation(); };\n      b.onclick')
    .replace('</head>', `<style>
:root{${tokens}}
.bp-detail{box-sizing:border-box;width:min(920px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:88vh;margin:auto;padding:0;border:1px solid var(--crew-hover-line);border-radius:8px;background:var(--crew-hover-paper);color:var(--crew-hover-ink);box-shadow:var(--crew-hover-shadow);font:16px/1.55 Arial,sans-serif;letter-spacing:0;overflow:hidden}
.bp-detail[open]{display:flex;flex-direction:column}
.bp-detail::backdrop{background:color-mix(in oklch,var(--crew-hover-ink) 45%,transparent)}
.bp-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:22px 24px 16px;border-bottom:1px solid var(--crew-hover-line)}
.bp-detail-eyebrow{font-size:14px;font-weight:700;color:var(--crew-hover-flite)}
.bp-detail h2{margin:6px 0 0;font-size:22px;line-height:1.35;overflow-wrap:anywhere}
.bp-detail .bp-detail-button{flex-shrink:0;min-height:38px;white-space:normal;padding:7px 12px;border:1px solid var(--crew-hover-line);border-radius:6px;background:var(--crew-hover-paper);color:var(--crew-hover-ink);font:700 14px/1.4 Arial,sans-serif;cursor:pointer}
.bp-detail .bp-detail-button:hover{background:var(--crew-hover-flite-soft);border-color:var(--crew-hover-flite)}
.bp-detail .bp-detail-button:focus-visible{outline:2px solid var(--crew-hover-flite);outline-offset:2px}
.bp-detail .bp-detail-button:disabled{opacity:.5;cursor:wait}
.bp-detail-bar{display:flex;gap:8px;flex-wrap:wrap;padding:12px 24px;background:var(--crew-hover-flite-soft)}
.bp-detail-list{min-height:0;overflow:auto;padding:8px 24px 20px;scrollbar-gutter:stable}
.bp-detail-item{padding:20px 0;border-bottom:1px solid var(--crew-hover-line)}
.bp-detail-item-head{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bp-detail-location{font:700 14px/1.4 monospace;color:var(--crew-hover-flite);background:var(--crew-hover-flite-soft);padding:4px 8px;border-radius:4px}
.bp-detail-ident{font:700 20px/1.4 monospace}
.bp-detail-item-head .bp-detail-button{margin-left:auto}
.bp-detail-text{font:15px/1.7 monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:12px 0;letter-spacing:0}
.bp-detail-reasons{font-size:14px;color:var(--crew-hover-muted);margin-top:8px}
.bp-detail-level{display:inline-block;font-size:12px;font-weight:800;margin-top:10px;padding:3px 8px;border-radius:4px;background:var(--crew-hover-flite-soft);color:var(--crew-hover-flite)}
.bp-detail-level.critical{background:var(--crew-hover-danger-soft);color:var(--crew-hover-danger)}
.bp-detail-foot{display:flex;gap:12px;justify-content:space-between;align-items:center;padding:12px 24px;border-top:1px solid var(--crew-hover-line)}
.bp-detail-status{color:var(--crew-hover-excel);font-size:14px;overflow-wrap:anywhere}
.bp-detail-empty{padding:32px 0;color:var(--crew-hover-muted)}
.bp-detail-copy{position:fixed;width:1px;height:1px;opacity:0}
@media(max-width:600px){.bp-detail{width:calc(100vw - 16px);max-width:calc(100vw - 16px);max-height:92vh}.bp-detail-head,.bp-detail-bar,.bp-detail-foot{padding:12px}.bp-detail-list{padding:0 12px 12px}.bp-detail h2{font-size:19px}}
</style></head>`);
}