/** Keep the source HTML intact; operational identity travels through the shim. */
export function patchFlightIdentityPage(html: string): string {
  return html
    .replace('const vAviEobt = {};', 'const vAviEobt = {};\nconst vAviDof = {};')
    .replace('      flt: r.flt, kind: r.atc.kind,', '      flt: r.flt, sector_id: r.sector_id || null, kind: r.atc.kind,')
    .replace('      avi_eobt: vAviEobt[vAviKey(vAviCs(r.flt), vAtcIsoDate(r))] || ""', '      avi_eobt: vAviEobt[vAviKey(vAviCs(r.flt), vAtcIsoDate(r))] || "",\n      avi_dof: vAviDof[vAviKey(vAviCs(r.flt), vAtcIsoDate(r))] || ""')
    .replace('JSON.stringify({callsigns: want, headless: true})', `JSON.stringify({callsigns: want, headless: true, items: [...document.querySelectorAll("#vBody tr")].map(tr => tr._row).filter(r => r && want.includes(vAviCs(r.flt))).map(r => {
          const route = String(r.route || "").split("-");
          return {flt:r.flt, sector_id:r.sector_id || null, date:vAtcIsoDate(r), dep:route[0] || "", arr:route[1] || ""};
        })})`)
    .replace('        if(!r || !r.flight_time) return;', '        if(!r || !r.ok || !r.flight_time || !r.dof) return;')
    .replace('            vAviEobt[vAviKey(cs, sp.dataset.date)] = r.flight_time; hit = true;', '            vAviEobt[vAviKey(cs, sp.dataset.date)] = r.flight_time;\n            vAviDof[vAviKey(cs, sp.dataset.date)] = r.dof; hit = true;')
    .replace(/        \/\/ Không khớp ngày nào[^\n]*\n        if\(!hit\)\{[\s\S]*?\n        \}/, '        // No fallback when the returned DOF does not match the selected row.')
    .replace('  if(!m || d.length !== 6) return true;', '  if(!m || d.length !== 6) return false;');
}