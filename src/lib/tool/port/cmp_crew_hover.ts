import styles from '@/styles.css?raw';

/** Presentation only: never normalize the names used by crew matching. */
export function cmpCrewDisplayRows(raw: unknown): {name:string;role:string;id:string}[] {
  return String(raw || '').split(/[;\n]+/).map(s=>s.trim()).filter(Boolean).map(text=>{
    const role = /\(([^)]+)\)/.exec(text);
    const id = role ? /\)\s*(\d{3,6})\s*$/.exec(text) : null;
    const name = text.replace(/^[-–]\s*/, '').replace(/\([^)]+\)\s*\d*\s*$/, '').trim();
    return {name:name || text,role:role?.[1] || '',id:id?.[1] || ''};
  });
}

export function patchCmpCrewHoverPage(html:string):string {
  const tokens = (styles.match(/^  --crew-hover-[^\n]+/gm) || []).join('\n');
  return html
    .replace('function tipHover(ev){', `
const cmpCrewDisplayRows = ${cmpCrewDisplayRows.toString()};
function cmpCrewHoverShow(ev, td){
  const data = td._cmpCrewDisplay || {};
  const el = tafTipEl();
  el.classList.remove("pcr-wide"); el.classList.add("cmp-crew-tip"); el.textContent = "";
  const node = (tag, cls, text) => {const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
  const head=node("div","crew-hover-head");
  head.append(node("span","crew-hover-heading","Tổ bay"));
  if(data.same !== null && data.same !== undefined) head.append(node("span","crew-hover-status" + (data.same ? "" : " mismatch"),data.same ? "✓ Khớp" : "≠ Có khác biệt"));
  el.append(head,node("div","crew-hover-file",cmpSourceTip("crew")));
  const grid=node("div","crew-hover-grid");
  for(const [key,label,icon] of [["excel","Excel","▦"],["flite","FliteBrief","✈"]]){
    const section=node("section","crew-hover-source " + key);
    const title=node("div","crew-hover-source-head");
    title.append(node("span","crew-hover-source-icon",icon),node("strong","",label));
    const people=cmpCrewDisplayRows(data[key]);
    title.append(node("span","crew-hover-count",people.length ? String(people.length) + " người" : "—"));
    section.append(title);
    const list=node("div","crew-hover-list");
    for(const person of people){
      const row=node("div","crew-hover-person");
      row.append(node("span","crew-hover-name",person.name));
      if(person.role || person.id){const meta=node("div","crew-hover-person-meta");if(person.role)meta.append(node("span","crew-hover-role",person.role));if(person.id)meta.append(node("span","crew-hover-id","ID " + person.id));row.append(meta);}
      list.append(row);
    }
    if(!people.length)list.append(node("div","crew-hover-empty",key === "excel" ? "Chưa có tổ bay từ Crewlist" : "Chưa đọc được tổ bay FliteBrief"));
    section.append(list);grid.append(section);
  }
  el.append(grid);
  if(data.detail)el.append(node("div","crew-hover-detail",data.detail));
  el.classList.add("show"); moveTafTip(ev);
}
function tipHover(ev){`)
    .replace('  const text = el && el.getAttribute("title");', `  const text = el && el.getAttribute("title");
  const crewCell = t.closest("#cmpBody td[data-crew-sid]");
  if(crewCell && crewCell._cmpCrewDisplay){
    tipRelease(); _tipHost = crewCell;
    if(crewCell.hasAttribute("title")){crewCell.setAttribute("data-tip",crewCell.title);crewCell.removeAttribute("title");}
    cmpCrewHoverShow(ev,crewCell); return;
  }`)
    .replace('  el.classList.remove("show", "pcr-wide");', '  el.classList.remove("show", "pcr-wide", "cmp-crew-tip");')
    .replace('  if(!inExcel || !cell || !cell.verdict){\n    const sidK', `  td._cmpCrewDisplay = {excel:inExcel && cell ? cell.excel || "" : "",flite:(cell && cell.flite) || CREW_NAMES[String(td.dataset.crewSid || "")] || "",same:cell && cell.verdict ? !!cell.same : null,detail:(cell && cell.detail) || ""};
  if(!inExcel || !cell || !cell.verdict){
    const sidK`)
    .replace('</head>', `<style>
:root{${tokens}}
#tafTip.cmp-crew-tip{background:var(--crew-hover-paper)!important;color:var(--crew-hover-ink)!important;border:1px solid var(--crew-hover-line)!important;box-shadow:var(--crew-hover-shadow)!important;font-family:var(--x-sans,system-ui)!important;font-size:calc(16px * var(--taf-read-scale,1))!important;line-height:1.45!important;width:min(calc(700px * var(--taf-read-scale,1)),calc((100vw - 28px) * var(--taf-read-scale,1)));padding:calc(18px * var(--taf-read-scale,1))!important;white-space:normal;letter-spacing:0}
.crew-hover-head{display:flex;justify-content:space-between;align-items:center;gap:12px}
.crew-hover-heading{font-size:1.2em;font-weight:800}
.crew-hover-status{color:var(--crew-hover-excel);background:var(--crew-hover-excel-soft);border-radius:6px;padding:.25em .6em;font-weight:700;font-size:.85em;flex-shrink:0}
.crew-hover-status.mismatch{color:var(--crew-hover-danger);background:var(--crew-hover-danger-soft)}
.crew-hover-file{font-size:.85em;color:var(--crew-hover-muted);margin:.5em 0 1em;overflow-wrap:anywhere}
.crew-hover-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1em}
.crew-hover-source{min-width:0;--crew-source:var(--crew-hover-excel);--crew-source-soft:var(--crew-hover-excel-soft)}
.crew-hover-source.flite{--crew-source:var(--crew-hover-flite);--crew-source-soft:var(--crew-hover-flite-soft)}
.crew-hover-source-head{display:flex;align-items:center;gap:.45em;background:var(--crew-source-soft);color:var(--crew-source);padding:.6em .7em;border-radius:6px;border-top:3px solid var(--crew-source)}
.crew-hover-source-icon{font-size:1.1em}.crew-hover-count{margin-left:auto;font-size:.75em;white-space:nowrap}
.crew-hover-person{padding:.75em .15em;border-bottom:1px solid var(--crew-hover-line)}
.crew-hover-name{display:block;font-weight:650;overflow-wrap:anywhere}
.crew-hover-person-meta{display:flex;align-items:center;gap:.55em;margin-top:.35em;font-size:.8em}
.crew-hover-role{color:var(--crew-source);background:var(--crew-source-soft);border-radius:4px;padding:.1em .4em;font-weight:700}
.crew-hover-id{color:var(--crew-hover-muted);font-family:var(--x-mono,monospace)}
.crew-hover-detail{margin-top:1em;padding-top:.8em;border-top:1px solid var(--crew-hover-line);font-size:.85em;color:var(--crew-hover-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.crew-hover-empty{padding:1em 0;color:var(--crew-hover-muted);font-size:.9em}
@media(max-width:580px){.crew-hover-grid{grid-template-columns:minmax(0,1fr)}.crew-hover-head{flex-wrap:wrap}}
</style></head>`);
}