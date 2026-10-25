/** Keep the source HTML intact; operational identity travels through the shim. */
const RETRY = `
function vAviRetry(want, why){
  let left = 0;
  document.querySelectorAll("#vBody span.vavi").forEach(sp => {
    const k = vAviKey(sp.dataset.cs, sp.dataset.date);
    if(want.includes(sp.dataset.cs) && !vAviEobt[k]){ delete vAviTried[k]; left++; }
  });
  if(!left) return;
  write("ATC avi: " + (why || "chưa lấy được EOBT gốc") + " — tự thử lại sau 30 giây", "fail");
  setTimeout(vAviAutoCheck, 30000);
}`;

export function patchFlightIdentityPage(html: string): string {
  return html
    .replace('const vAviEobt = {};', 'const vAviEobt = {};\nconst vAviDof = {};' + RETRY)
    .replace('      flt: r.flt, kind: r.atc.kind,', '      flt: r.flt, sector_id: r.sector_id || null, kind: r.atc.kind,\n      etd_cur: (r.delay && r.delay.to) || "", etd_old: (r.delay && r.delay.from) || "",')
    .replace('      avi_eobt: vAviEobt[vAviKey(vAviCs(r.flt), vAtcIsoDate(r))] || ""', '      avi_eobt: vAviEobt[vAviKey(vAviCs(r.flt), vAtcIsoDate(r))] || "",\n      avi_dof: vAviDof[vAviKey(vAviCs(r.flt), vAtcIsoDate(r))] || ""')
    .replace('JSON.stringify({callsigns: want, headless: true})', `JSON.stringify({callsigns: want, headless: true, items: [...document.querySelectorAll("#vBody tr")].map(tr => tr._row).filter(r => r && want.includes(vAviCs(r.flt))).map(r => {
          const route = String(r.route || "").split("-");
          return {flt:r.flt, sector_id:r.sector_id || null, date:vAtcIsoDate(r), dep:route[0] || "", arr:route[1] || ""};
        })})`)
    .replace('      if(d.error){ write("ATC avi: " + d.error, "fail"); vAviBusy = false; return; }', '      if(d.error){ vAviBusy = false; vAviRetry(want, d.error); return; }')
    .replace('        if(!r || !r.flight_time) return;', '        if(!r || !r.ok || !r.flight_time || !r.dof) return;')
    .replace('            vAviEobt[vAviKey(cs, sp.dataset.date)] = r.flight_time; hit = true;', '            vAviEobt[vAviKey(cs, sp.dataset.date)] = r.flight_time;\n            vAviDof[vAviKey(cs, sp.dataset.date)] = r.dof; hit = true;')
    .replace(/        \/\/ Không khớp ngày nào[^\n]*\n        if\(!hit\)\{[\s\S]*?\n        \}/, '        // No fallback when the returned DOF does not match the selected row.')
    .replace('            es.close(); vAviBusy = false; vPaintAllDla();', '            es.close(); vAviBusy = false; vPaintAllDla(); vAviRetry(want);')
    .replace('      es.onerror = () => { es.close(); vAviBusy = false; };', '      es.onerror = () => { es.close(); vAviBusy = false; vAviRetry(want, "mất kết nối khi check"); };')
    .replace('    }catch(err){ vAviBusy = false; write("ATC avi: " + err.message, "fail"); }', '    }catch(err){ vAviBusy = false; vAviRetry(want, err.message); }')
    .replace('  if(!m || d.length !== 6) return true;', '  if(!m || d.length !== 6) return false;');
}
