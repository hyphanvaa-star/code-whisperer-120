import { staffDigits, type CrewRow } from './crewswap';

/** Same identity as crew swaps: staff ID, active operating role, old pilot absent. */
export function crewChangeMatches(rows: CrewRow[], role: string, from: unknown, to: unknown): boolean {
  const firstId = (v: unknown) => staffDigits(/^\s*(\d+)\b/.exec(String(v ?? ''))?.[1] ?? '');
  const oldId = firstId(from), newId = firstId(to);
  if (!newId) return false;
  const active = rows.filter(r => !r.deleted_on && !r.deadheading);
  const job = (r: CrewRow) => typeof r.job === 'object' ? r.job?.name : r.job;
  return active.some(r => staffDigits(r.username) === newId && job(r) === role)
    && (!oldId || oldId === newId || !active.some(r => staffDigits(r.username) === oldId));
}

export function patchKhbCrewSyncPage(html: string): string {
  return html
    .replace('V 2.98</span>', 'V 2.99</span>')
    .replace('      return force || !r || !r.found || !r.ok;', '      return force || !r || !r.found || !r.ok || !!(ftSt(f).chg && Object.keys(ftSt(f).chg).length);')
    .replace('return {flt: f.flt, dep: st.dep || f.dep || "", arr: st.arr || f.arr || "", date: st.date || f.date || ""};', `return {flt: f.flt, dep: st.dep || f.dep || "", arr: st.arr || f.arr || "", date: st.date || f.date || "",
        crew_changes: ["cptText", "foText"].filter(key => st.chg && st.chg[key]).map(key => ({key, from: st.chg[key].from, to: st.chg[key].to}))};`)
    .replace('        st.chgFb = regOk && timeOk;', `        st.chgFb = regOk && timeOk;
        if(it.crew_checked && st.chg) (it.crew_changes || []).forEach(result => {
          const c = st.chg[result.key];
          if(c && c.from === result.from && c.to === result.to){ c.fbOk = result.ok; c.done = result.ok; }
        });`)
    .replace('return c.done === true || (st.chgFb === true', 'return c.done === true || c.fbOk === true || (st.chgFb === true')
    .replace('  const sid = f.id, flt =', '  let sid = 0; const flt =')
    .replace('  c.busy = true; c.bolt.textContent = "…";\n  try{', `  c.busy = true; c.bolt.textContent = "…";
  try{
    const identity = {flt: f.flt, date: st.date || f.date, dep: st.dep || f.dep, arr: st.arr || f.arr,
      crew_changes: key === "reg" ? [] : [{key, from: c.from, to: c.to}]};
    const check = await (await fetch("/api/version/fbreg", {method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({items: [identity]})})).json();
    const current = (check.items || [])[0];
    if(!current || !current.found || !current.sector_id){ alert((current && current.error) || "Không tìm thấy đúng chuyến/ngày/chặng trên FliteBrief."); return; }
    sid = current.sector_id;
    if(key !== "reg"){
      if(!current.crew_checked){ alert(current.crew_error || "Chưa đọc được crew hiện tại — không gửi thay đổi."); return; }
      const result = (current.crew_changes || [])[0];
      if(result && result.ok){ c.done = true; c.fbOk = true; return; }
    }`)
    .replace('      if(!(d.remove || []).length && !(d.add || []).length){ c.done = true; return; }\n      L.push("", "Cập nhật lên FliteBrief ngay?");\n      if(!confirm(L.join("\\n"))) return;\n      const r = await (await fetch("/api/crewswap/run"', `      if((d.not_found || []).length){ alert(L.join("\\n")); return; }
      if(!(d.remove || []).length && !(d.add || []).length){ ftFbSync(true); return; }
      L.push("", "Cập nhật lên FliteBrief ngay?");
      if(!confirm(L.join("\\n"))) return;
      const r = await (await fetch("/api/crewswap/run"`)
    .replace('      c.done = await ftStream(r.id);\n      if(!c.done) alert("Đổi crew chưa xong — xem lại trên FliteBrief.");', `      const completed = await ftStream(r.id);
      c.done = false; c.fbOk = false;
      ftFbSync(true);
      if(!completed) alert("Đổi crew chưa xong — xem lại trên FliteBrief.");`);
}