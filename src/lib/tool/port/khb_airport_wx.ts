/** KHB airport cells: weather warning marker from the existing per-place TAF verdict. */
export type WxPlace = { status?: string; why?: string; when?: string; code?: string; icao?: string } | null | undefined;
export type WxMark = { level: "" | "bad" | "nil" | "missing"; label: string; why: string };

// Self-contained: injected into the tool page via toString().
export function wxMark(p: WxPlace): WxMark {
  if (!p) return { level: "", label: "", why: "" };
  const s = String(p.status || "");
  const at = p.when ? " tại " + p.when : "";
  const why = String(p.why || "");
  if (s === "bad") return { level: "bad", label: "⚠", why: "⚠ WX xấu" + at + (why ? ": " + why : "") };
  if (s === "nil") return { level: "nil", label: "NIL", why: "TAF NIL / ngoài hiệu lực" + at + (why ? ": " + why : "") + " — cần tra nguồn khác" };
  if (s === "missing") return { level: "missing", label: "", why: "Chưa có TAF cho sân này" };
  return { level: "", label: "", why: "" };
}

const CSS = `<style>
#wrapFplText .fttbl td.ft-wx-bad,#wrapFplText .fttbl td.ft-wx-nil,#wrapFplText .fttbl td.ft-wx-missing{position:relative}
#wrapFplText .fttbl td.ft-wx-bad>input{box-shadow:inset 0 0 0 2px #DC2626 !important}
#wrapFplText .fttbl td.ft-wx-bad.ft-wx-new>input{animation:ftWxBlink .8s ease-in-out 4}
#wrapFplText .fttbl td.ft-wx-nil>input{box-shadow:inset 0 0 0 2px #EA580C !important}
#wrapFplText .fttbl td.ft-wx-missing>input{outline:1px dashed #94A3B8;outline-offset:-2px}
#wrapFplText .fttbl td[data-wx-label]::after{content:attr(data-wx-label);position:absolute;top:0;right:2px;font-size:10px;font-weight:900;line-height:1;pointer-events:none}
#wrapFplText .fttbl td.ft-wx-bad::after{color:#DC2626}
#wrapFplText .fttbl td.ft-wx-nil::after{color:#EA580C}
@keyframes ftWxBlink{50%{box-shadow:inset 0 0 0 4px #DC2626 !important}}
.taf-tip .ft-wx-sum{font-weight:800;margin-bottom:8px}.taf-tip .ft-wx-sum.bad{color:#F87171}.taf-tip .ft-wx-sum.nil{color:#FB923C}.taf-tip .ft-wx-sum.missing{color:#94A3B8}
</style>`;

const PAINTER = `
var wxMark = ${wxMark.toString()};
function ftWxPaint(){
  document.querySelectorAll("#wrapFplText [data-ft-airport-hover]").forEach(function(el){
    var td = el.closest ? (el.closest("td") || el) : el;
    var p = null; try{ p = typeof el._ftWxSrc === "function" ? el._ftWxSrc() : null; }catch(e){}
    var m = wxMark(p);
    var prev = td.dataset.wxLevel || "";
    if(prev === m.level && td.dataset.wxWhy === m.why) return;
    td.classList.remove("ft-wx-bad","ft-wx-nil","ft-wx-missing","ft-wx-new");
    if(m.level){ td.classList.add("ft-wx-" + m.level); if(m.level === "bad" && prev !== "bad") td.classList.add("ft-wx-new"); }
    if(m.label) td.dataset.wxLabel = m.label; else delete td.dataset.wxLabel;
    td.dataset.wxLevel = m.level; td.dataset.wxWhy = m.why; el._ftWxMark = m;
  });
}
setInterval(ftWxPaint, 1500);
`;

export function patchKhbAirportWxPage(html: string): string {
  return html
    .replace('if(el){ el.dataset.ftAirportHover = "1"; el._ftAirportLimits = limits; }', 'if(el){ el.dataset.ftAirportHover = "1"; el._ftAirportLimits = limits; el._ftWxSrc = typeof source === "function" ? source : () => source; }')
    .replace('  moveTafTip(ev);\n}\nfunction ftWatchTaf(el, source, limits){', '  { const m = wxMark(pack); if(m.level){ const s = document.createElement("div"); s.className = "ft-wx-sum " + m.level; s.textContent = m.why; tip.insertBefore(s, tip.firstChild); } }\n  moveTafTip(ev);\n}\nfunction ftWatchTaf(el, source, limits){')
    .replace('function ftShowAirportTip(', PAINTER + 'function ftShowAirportTip(')
    .replace('</head>', CSS + '</head>');
}
