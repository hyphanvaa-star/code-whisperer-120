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
    .replace(/function ftApplyCrewDiff\(src\)\{[\s\S]*?(?=\/\* Nguồn thay đổi:)/, `let ftCrewChanges = null, ftCrewChangesSeq = 0;
async function ftReadCrewChanges(source){
  const seq = ++ftCrewChangesSeq;
  const response = await fetch("/api/version/files");
  const data = await response.json();
  if(!response.ok || data.error) throw new Error(data.error || "Chưa đọc được Crewlist.");
  const files = (data.files || []).filter(f => !/\\bVER\\s*\\d+/i.test(f.name));
  const index = files.findIndex(f => f.name === source);
  if(index < 0) throw new Error("Chưa xác định được Crewlist đang dùng.");
  const older = files[index + 1], current = files[index];
  let rows = [];
  if(older){
    const params = new URLSearchParams({old: older.name, new: current.name});
    const result = await fetch("/api/version/diff?" + params);
    const diff = await result.json();
    if(!result.ok || diff.error) throw new Error(diff.error || "Chưa đối chiếu được hai Crewlist.");
    rows = diff.rows || [];
  }
  if(seq !== ftCrewChangesSeq) return false;
  ftCrewChanges = {source, pair: JSON.stringify([older || null, current]), rows};
  return true;
}
function ftApplyCrewDiff(src){
  if(!src || !ftCrewChanges || ftCrewChanges.source !== src) return 0;
  const norm = v => String(v == null ? "" : v).trim().toUpperCase();
  const digits = v => String(v || "").replace(/\\D/g, "").replace(/^0+/, "");
  let total = 0;
  for(let i = 0; i < ftRows.length; i++){
    const f = ftRows[i]; if(!f) continue;
    const st = ftSt(f), previous = st.chg || {};
    const same = ftCatalog.filter(c => digits(c.flt) === digits(f.flt) && norm(c.date) === norm(f.date));
    const exact = same.filter(c => norm(c.dep) === norm(f.dep) && norm(c.arr) === norm(f.arr));
    const nf = exact.find(c => norm(c.etd) === norm(f.etd)) || (exact.length === 1 ? exact[0] : null);
    if(nf){
      const before = {}; for(const [key] of FT_CHG_KEYS) before[key] = st[key];
      const sourceChanged = {};
      for(const [key, field] of FT_CHG_KEYS) sourceChanged[key] = norm(f[field]) !== norm(nf[field]);
      if(String(nf.id) !== String(f.id)){ ftEdit[String(nf.id)] = st; delete ftEdit[String(f.id)]; }
      if(sourceChanged.cptText) st.cptId = "";
      if(sourceChanged.foText) st.foId = "";
      ftFillIdent(st, nf);
      for(const [key] of FT_CHG_KEYS) if(!sourceChanged[key]) st[key] = before[key];
      ftRows[i] = nf;
    }
    const route = norm((nf || f).dep) + "-" + norm((nf || f).arr);
    const day = String((nf || f).date || "").slice(0, 5);
    const matches = ftCrewChanges.rows.filter(r => digits(r.flt) === digits(f.flt) && norm(r.route) === route && r.day_new === day);
    const hit = matches.length === 1 ? matches[0] : null, chg = {};
    const add = (key, from, to) => {
      if(norm(from) === norm(to)) return;
      const old = previous[key];
      chg[key] = old && st.chgPair === ftCrewChanges.pair && old.src === "crew" && norm(old.from) === norm(from) && norm(old.to) === norm(to)
        ? old : {from, to, a: "Crewlist trước", b: src, src: "crew"};
      total++;
    };
    if(hit){
      if(hit.reg && hit.reg.changed) add("reg", hit.reg.old, hit.reg.new);
      if(hit.delay && hit.delay.changed) add("etd", hit.delay.from, hit.delay.to);
      if(hit.crew && hit.crew.changed && typeof cmpPilotChanges === "function"){
        for(const change of cmpPilotChanges(hit.crew.raw_old, hit.crew.raw_new)){
          add(change.key, change.from, change.to);
        }
      }
    }
    if(st.chgPair !== ftCrewChanges.pair || Object.keys(chg).some(key => chg[key] !== previous[key])){
      st.chgFb = false; st.regFb = false;
    }
    st.chg = chg; st.src = src; st.chgPair = ftCrewChanges.pair;
  }
  return total;
}
`)
    .replace('    const nChg = ftApplyCrewDiff(d.source || "");', '    if(!await ftReadCrewChanges(d.source || "")) return;\n    const nChg = ftApplyCrewDiff(d.source || "");')
    .replace('    if(nChg) try{ ftKeepLater(); }catch(e){}', '    try{ ftKeepLater(); }catch(e){}')
    .replace(/function ftApplyVerDiff\(\)\{[\s\S]*?(?=\/\/ Sau khi đối chiếu FliteBrief:)/, 'function ftApplyVerDiff(){ /* KHB markers come only from the current Crewlist pair. */ }\n')
    .replace('V 2.98</span>', 'V 2.99</span>')
    .replace('      return force || !r || !r.found || !r.ok;', '      return force || !r || !r.found || !r.ok || !!(ftSt(f).chg && Object.keys(ftSt(f).chg).length);')
    .replace('return {flt: f.flt, dep: st.dep || f.dep || "", arr: st.arr || f.arr || "", date: st.date || f.date || ""};', `return {flt: f.flt, dep: st.dep || f.dep || "", arr: st.arr || f.arr || "", date: st.date || f.date || "",
        crew_changes: ["cptText", "foText"].filter(key => st.chg && st.chg[key]).map(key => ({key, from: st.chg[key].from, to: st.chg[key].to}))};`)
    .replace('        st.chgFb = regOk && timeOk;', `        st.chgFb = regOk && timeOk;
        st.regFb = regOk;
        if(it.crew_checked && st.chg) (it.crew_changes || []).forEach(result => {
          const c = st.chg[result.key];
          if(c && c.from === result.from && c.to === result.to){ c.fbOk = result.ok; c.done = result.ok; }
        });`)
    .replace('return c.done === true || (st.chgFb === true', 'return c.done === true || c.fbOk === true || (c.key === "reg" && st.regFb === true) || (st.chgFb === true')
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