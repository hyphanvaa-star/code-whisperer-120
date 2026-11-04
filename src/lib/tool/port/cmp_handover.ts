/** Compare-only scope; the primary dispatcher and other tabs stay unchanged. */
export function cmpHandoverRows<T extends { sector_id: unknown; dsp?: string }>(rows: T[], primary: string, handovers: string[]): (T & { handover: boolean })[] {
  const key = (v: string) => String(v || '').toUpperCase().replace(/\s+/g, ' ').trim();
  const main = key(primary);
  const wanted = new Set(handovers.map(key).filter(v => v && v !== main));
  const seen = new Set<unknown>();
  const selected = rows.filter(r => {
    if (seen.has(r.sector_id) || (main && key(r.dsp || '') !== main && !wanted.has(key(r.dsp || '')))) return false;
    seen.add(r.sector_id);
    return true;
  }).map(r => ({ ...r, handover: wanted.has(key(r.dsp || '')) }));
  return [...selected.filter(r => r.handover), ...selected.filter(r => !r.handover)];
}

export function patchCmpHandoverPage(html: string): string {
  return html
    .replace('async function runCompare(opts){', `
const cmpHandoverRows = ${cmpHandoverRows.toString()};
const cmpHandoverDsps = new Set();
let cmpHandoverRevision = 0;
function cmpHandoverHas(name){ return cmpHandoverDsps.has(dspKey(name)); }
function cmpHandoverToggle(name){
  const key = dspKey(name);
  if(!key || key === dspKey($("#fDispatcher").value)) return;
  if(cmpHandoverDsps.has(key)) cmpHandoverDsps.delete(key); else cmpHandoverDsps.add(key);
  // Cached misses may come from a read scoped to the primary DSP; retry them.
  if(typeof C_CACHE === "object") for(const k of Object.keys(C_CACHE)) if(!C_CACHE[k]) delete C_CACHE[k];
  if(xls) runCompare();
  else alert("Đã chọn DSP giao ca — chọn Crewlist để nạp bảng So sánh.");
}
function cmpFlightPool(){
  const byId = new Map();
  for(const f of (allFlights || [])) byId.set(String(f.id), f);
  for(const f of (flights || [])) byId.set(String(f.id), f);
  return [...byId.values()].filter(inOpsWindow);
}
function cmpCrewParams(rows){
  const p = new URLSearchParams(qs());
  // Match the Compare read only; IDs still limit each crew batch.
  if((rows || []).some(r => r.handover) || (typeof cmpHandoverDsps !== "undefined" && cmpHandoverDsps.size)) p.delete("dispatcher");
  return p;
}
async function runCompare(opts){
  const handoverRevision = ++cmpHandoverRevision;
  const primaryDsp = $("#fDispatcher").value;
  const handoverDsps = [...cmpHandoverDsps];
  const scopeQs = qs();`)
    .replace('    const p = new URLSearchParams(qs());\n    p.set("file", xls.file);', '    const p = new URLSearchParams(scopeQs);\n    if(handoverDsps.length) p.delete("dispatcher");\n    p.set("file", xls.file);')
    .replace('    cmpQs = qs();', '    cmpQs = scopeQs;')
    .replace('      const p = new URLSearchParams(qs());\n      if(xls && xls.file) p.set("file", xls.file);', '      const p = cmpCrewParams(rows);\n      if(xls && xls.file) p.set("file", xls.file);')
    .replace('      const p = new URLSearchParams(qs());\n      p.set("ids", chunk.join(","));\n      const d = await (await fetch("/api/excel/crewnames?"', '      const p = cmpCrewParams((lastCmp && lastCmp.table) || []);\n      p.set("ids", chunk.join(","));\n      const d = await (await fetch("/api/excel/crewnames?"')
    .replace('    lastCmp = d;\n    paintCompare(d);', `    if(handoverRevision !== cmpHandoverRevision || scopeQs !== qs()) return;
    d.table = cmpHandoverRows(d.table || [], primaryDsp, handoverDsps);
    lastCmp = d;
    paintCompare(d);`)
    .replace('    btn.disabled = false; btn.textContent = "Cmp";', '    if(handoverRevision === cmpHandoverRevision){ btn.disabled = false; btn.textContent = "Cmp"; }')
    .replace('    const cs = txtCell(r.callsign + (r.note ? " ⚠" : ""), "n");', `    const cs = txtCell(r.callsign + (r.note ? " ⚠" : ""), "n");
    if(r.handover){
      tr.classList.add("cmp-handover-row");
      cs.innerHTML = '<span class="cmp-handover-top"><span class="cmp-handover-cs"></span></span>';
      cs.querySelector(".cmp-handover-cs").textContent = r.callsign + (r.note ? " ⚠" : "");
       const handoverTag = document.createElement("span");
      handoverTag.className = "cmp-handover-tag";
      handoverTag.textContent = "HO";
      handoverTag.setAttribute("aria-label", "Chuyến giao ca");
      cs.firstChild.appendChild(handoverTag);
    }`)
    .replace('  const crewLater = !!d.crew_pending;\n\n  for(const r of rows){', '  const crewLater = !!d.crew_pending;\n  let cmpPrevHandover = false;\n\n  for(const r of rows){')
    .replace('    };\n    tb.appendChild(tr);\n  }', `    };
    if(cmpPrevHandover && !r.handover){
      const sep = document.createElement("tr");
      sep.className = "cmp-sep";
      const sepTd = document.createElement("td");
      sepTd.colSpan = CMP_HEAD.length;
      sepTd.innerHTML = '<span class="cmp-sep-plane">✈</span>';
      sep.appendChild(sepTd);
      tb.appendChild(sep);
    }
    cmpPrevHandover = !!r.handover;
    tb.appendChild(tr);
  }`)
    // These lookups must include handover flights to retain CFP/OFP safeguards.
    .replaceAll('const f = flights.find(x => String(x.id) === String(id) || x.id === Number(id));', 'const f = cmpFlightPool().find(x => String(x.id) === String(id) || x.id === Number(id));')
    .replaceAll('const f = flights.find(x => x.id === nid || String(x.id) === String(id));', 'const f = cmpFlightPool().find(x => x.id === nid || String(x.id) === String(id));')
    .replace('</head>', `<style>
.cmptbl .cmp-handover-cs{display:inline-block;padding:2px 9px;border-radius:7px;font-weight:800;color:#713f12;background:linear-gradient(180deg,#fde047,#facc15);border:1px solid #eab308;box-shadow:0 1px 3px rgba(234,179,8,.45),inset 0 1px 0 rgba(255,255,255,.5)}
.cmptbl .cmp-handover-top{display:inline-flex;align-items:center;gap:9px;white-space:nowrap;padding-right:5px}
.cmptbl .cmp-handover-tag{position:relative;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:36px;height:24px;padding:2px 7px;border-radius:6px;font-size:12px;line-height:18px;font-weight:800;letter-spacing:0;color:var(--handover-on-pink)!important;-webkit-text-fill-color:var(--handover-on-pink)!important;background:var(--handover-pink);border:1.5px solid var(--handover-flower);box-shadow:0 0 0 2px var(--handover-halo)}
.cmptbl .cmp-handover-tag::before,.cmptbl .cmp-handover-tag::after{content:"🌸";position:absolute;width:13px;height:13px;font-size:12px;line-height:13px;pointer-events:none}
.cmptbl .cmp-handover-tag::before{top:-7px;left:-6px}.cmptbl .cmp-handover-tag::after{bottom:-6px;right:-6px}
.cmptbl .cmp-handover-row td:first-child{border-left:3px solid var(--amber)}
.cmptbl tr.cmp-sep td{padding:0;border:none;height:16px;position:relative;background:transparent}
.cmptbl tr.cmp-sep td::before{content:"";position:absolute;left:0;right:0;top:50%;height:2px;margin-top:-1px;background:linear-gradient(90deg,transparent,var(--x-red) 6%,var(--x-red) 94%,transparent)}
.cmptbl .cmp-sep-plane{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--x-red);color:#fff;font-size:12px;line-height:1;box-shadow:0 1px 4px rgba(220,38,38,.5)}
#ddPop .dd-handover{flex:0 0 30px;min-height:30px;width:30px;padding:0;border-radius:6px;border:1px solid var(--x-line);color:var(--x-red);background:var(--x-card);font-size:20px;font-weight:800;line-height:28px;cursor:pointer}
#ddPop .dd-handover[aria-pressed="true"]{background:var(--x-red);color:var(--x-card);border-color:var(--x-red)}
#ddPop .dd-handover:disabled{opacity:.3;cursor:default}
</style></head>`);
}