/** Compare tab: one Validation column summarising FUEL/TOW/LWT/ZFW/ETP/CONT-ERA; source cells stay hidden for hover data. */
export function cmpValidationVerdict(items: { label: string; level: 'ok' | 'warn' | 'bad' | 'pending' }[]) {
  if (items.some((i) => i.level === 'bad')) return 'bad';
  if (items.some((i) => i.level === 'warn')) return 'warn';
  if (items.some((i) => i.level === 'pending')) return 'pending';
  return 'good';
}

export function patchCmpValidationPage(html: string): string {
  return html
    .replace(/(id="appVersion"[^>]*>)V [\d.]+/, '$1V 3.07')
    .replace('function renderCompareTable(d, opts){', `
const cmpValidationVerdict = ${cmpValidationVerdict.toString()};
const CMP_VAL_KEYS = [["fuel","FUEL"],["tow","TOW"],["lwt","LWT"],["ezfw","ZFW"],["rres","CONT/ERA"],["etp","ETP"]];
function cmpValPaint(sid){
  const td = document.querySelector('#cmpBody td[data-w="val"][data-sid="' + sid + '"]');
  if(!td) return;
  const tr = td.closest("tr"), items = [];
  for(const [k, label] of CMP_VAL_KEYS){
    const c = tr.querySelector('td[data-w="' + k + '"]');
    const t = c ? c.textContent.trim() : "";
    let level = "ok";
    if(!c || !t || /^[—….·]+$/.test(t)) level = k === "etp" ? "ok" : "pending";
    else if(c.querySelector(".bad,.crit,.pcr-hot,.fuel-tight")) level = "bad";
    else if(c.querySelector(".warn,.pcr-near")) level = "warn";
    items.push({label, level, text: (c && c.title) || t});
  }
  const v = cmpValidationVerdict(items);
  td.dataset.val = v;
  td.innerHTML = "";
  const head = document.createElement("div");
  head.className = "cmp-val-head";
  head.textContent = v === "good" ? "Good" : v === "bad" ? "Cảnh báo đỏ" : v === "warn" ? "Tiệm cận" : "Chờ dữ liệu";
  td.appendChild(head);
  for(const i of items) if(i.level === "bad" || i.level === "warn"){
    const line = document.createElement("div");
    line.className = "cmp-val-line " + i.level;
    line.textContent = i.label + ": " + String(i.text).split("\\n")[0];
    td.appendChild(line);
  }
  td.title = items.map(i => i.label + " — " + (i.level === "ok" ? "OK" : i.level === "pending" ? "chưa có" : i.level === "warn" ? "tiệm cận" : "sai") + (i.text ? "\\n  " + String(i.text).replace(/\\n/g, "\\n  ") : "")).join("\\n");
}
function renderCompareTable(d, opts){`)
    .replace('    + "FALSE nếu Cont Fuel hoặc ERA lệch — hoặc cả hai."],', '    + "FALSE nếu Cont Fuel hoặc ERA lệch — hoặc cả hai."],\n  ["VALIDATION", "Gộp FUEL, TOW, LWT, ZFW, CONT/ERA, ETP. Xanh Good = tất cả đạt; vàng = tiệm cận; đỏ = sai. Rê chuột xem chi tiết."],')
    .replace(`    for(const k of ["ezfw", "etp", "rres"]){
      const td = document.createElement("td");
      td.dataset.w = k;
      td.dataset.sid = r.sector_id;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`, `    for(const k of ["ezfw", "etp", "rres", "val"]){
      const td = document.createElement("td");
      td.dataset.w = k;
      td.dataset.sid = r.sector_id;
      td.innerHTML = '<span class="v q">…</span>';
      tr.appendChild(td);
    }`)
    .replace('  paintDelta(sid);\n}\n\n/* EST (Omni)', '  paintDelta(sid);\n  cmpValPaint(sid);\n}\n\n/* EST (Omni)')
    .replace('</head>', `<style>
.cmptbl :is(th,td):nth-child(9),.cmptbl :is(th,td):nth-child(n+13):nth-child(-n+17){display:none!important}
.cmptbl td[data-w="val"]{min-width:150px;font-size:12px;line-height:1.35}
.cmptbl .cmp-val-head{display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;background:#e5e7eb;color:#374151}
.cmptbl td[data-val="good"] .cmp-val-head{background:#16a34a;color:#fff}
.cmptbl td[data-val="warn"] .cmp-val-head{background:#facc15;color:#422006}
.cmptbl td[data-val="bad"] .cmp-val-head{background:#dc2626;color:#fff}
.cmptbl .cmp-val-line{margin-top:3px;font-weight:600;white-space:nowrap}
.cmptbl .cmp-val-line.warn{color:#a16207}.cmptbl .cmp-val-line.bad{color:#dc2626}
</style></head>`);
}
