/** Compose existing KHB limits and weather renderers without changing verdicts. */
export function patchKhbAirportHoverPage(html: string): string {
  return html
    .replace('function ftWatchTaf(el, source){', `function ftShowAirportTip(ev, el, pack, fallback){
  const limits = typeof el._ftAirportLimits === "function" ? el._ftAirportLimits() : [];
  showTafTip(ev, pack ? [pack.code, pack.role, pack.when].filter(Boolean).join(" ") : "TAF", (pack && pack.segments) || [], (pack && (pack.raw || pack.why)) || fallback);
  const tip = tafTipEl();
  const weather = document.createElement("div");
  weather.className = "ft-airport-weather";
  while(tip.firstChild) weather.appendChild(tip.firstChild);
  if(limits.length){
    showLimitTip(ev, "Giới hạn sân bay", limits.map(h => ({severity:h.sev, text:h.why})));
    tip.appendChild(weather);
  }else tip.appendChild(weather);
  moveTafTip(ev);
}
function ftWatchTaf(el, source, limits){
  if(el){ el.dataset.ftAirportHover = "1"; el._ftAirportLimits = limits; }`)
    .replace('const paint = p => showTafTip(ev, p ? [p.code, p.role, p.when].filter(Boolean).join(" ") : "TAF", (p && p.segments) || [], (p && (p.raw || p.why)) || "Chưa có TAF cho sân này; bấm TAF để cập nhật.");', 'const paint = p => ftShowAirportTip(ev, el, p, "Chưa có TAF cho sân này; bấm TAF để cập nhật.");')
    .replace('showTafTip(ev, "TAF", [], "Đang lấy TAF…");', 'ftShowAirportTip(ev, el, null, "Đang lấy TAF…");')
    .replace('showTafTip(ev, "TAF", [], err.message || "Không tải được TAF; bấm TAF để thử lại.");', 'ftShowAirportTip(ev, el, null, err.message || "Không tải được TAF; bấm TAF để thử lại.");')
    .replace('ftWatchTaf(td, () => ftTafPlace(st, st[key], "ETA"));', 'ftWatchTaf(td, () => ftTafPlace(st, st[key], "ETA"), () => ftLimHits(st)[key] || []);')
    .replace('ftWatchTaf(depCell, () => ftTafPlace(st, st.dep, "ETD"));', 'ftWatchTaf(depCell, () => ftTafPlace(st, st.dep, "ETD"), () => ftLimHits(st).dep);')
    .replace('ftWatchTaf(arrCell, () => ftTafPlace(st, st.arr, "ETA"));', 'ftWatchTaf(arrCell, () => ftTafPlace(st, st.arr, "ETA"), () => ftLimHits(st).arr);')
    .replace('  if(why.length) inp.title = why.join("\\n");', '  if(inp.closest("[data-ft-airport-hover]")){ inp.removeAttribute("title"); inp.removeAttribute("data-tip"); return; }\n  if(why.length) inp.title = why.join("\\n");')
    .replace('  if(!t || !t.closest) return;\n  if(t.closest("#wrapGeneral', '  if(!t || !t.closest) return;\n  if(t.closest("[data-ft-airport-hover]")) return;\n  if(t.closest("#wrapGeneral')
    .replace('</head>', '<style>.taf-tip .ft-airport-weather{border-top:1px solid var(--hover-muted);margin-top:12px;padding-top:12px}.taf-tip .ft-airport-weather:only-child{border-top:0;margin-top:0;padding-top:0}</style></head>');
}