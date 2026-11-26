// Briefing cells the dispatcher must complete by hand: airports without a TAF and FIRs whose
// SIGMETs could not be read. Pure + browser-safe; the tool page reads the result from the edit form.
import { SIGMET_NO_TIME } from "./briefing_sigmet";

export const TAF_PASTE_HINT = "[Dán TAF vào đây]";
/** Ready-made cell for an airport without a TAF; the hint never reaches the printed sheet. */
export const tafTemplate = (icao: string) => `TAF ${icao} ${TAF_PASTE_HINT}`;

const RX = /^Rx \d{6}Z\s+/i;
const NIL_TAF = /^(TAF\s+)?((AMD|COR)\s+)?([A-Z]{4}\s+)?(\d{6}Z\s+)?NIL=?$/i;

/** True when a weather cell carries no forecast: NIL, an untouched template, or blank. */
export function isTafEmpty(text: unknown): boolean {
  const body = String(text ?? "").trim().replace(RX, "").trim();
  return !body || body.includes(TAF_PASTE_HINT) || NIL_TAF.test(body.replace(/\s+/g, " "));
}

/** Form text → sheet text: an untouched template prints as `TAF <ICAO> NIL`, pasted content loses only the hint. */
export function stripTafHint(text: string): string {
  if (!text.includes(TAF_PASTE_HINT)) return text;
  const rest = text.split(TAF_PASTE_HINT).join(" ").replace(/[ \t]+/g, " ").trim();
  return /^TAF\s+[A-Z]{4}$/i.test(rest) ? `${rest} NIL` : rest || "NIL";
}

interface WxLike { icaos: string[]; texts: string[] }

/** Airports of one weather block that still have no forecast text. */
export function blockMissingTafs(block: WxLike | null | undefined): string[] {
  if (!block) return [];
  const icaos = (block.icaos || []).filter(Boolean);
  const texts = (block.texts || []).map((t) => String(t ?? ""));
  if (texts.length === icaos.length) return icaos.filter((_, i) => isTafEmpty(texts[i]));
  const real = texts.filter((t) => !isTafEmpty(t)).map((t) => t.toUpperCase());
  return icaos.filter((icao) => !real.some((t) => new RegExp(`\\b${icao}\\b`).test(t)));
}

/** FIRs named by the "SIGMET NOT AVAILABLE" lines still present in the SIG Wx cell. */
export function sigmetUnreadFirs(text: unknown): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(/^\s*([A-Z]{4}): SIGMET NOT AVAILABLE/gm)) if (m[1]) out.add(m[1]);
  return [...out];
}

export interface BriefingAttention { taf: string[]; firs: string[]; noTime: boolean }

export function attentionOf(sheet: { wx: WxLike[]; sig_wx: string }): BriefingAttention {
  const taf = [...new Set((sheet.wx || []).flatMap((b) => blockMissingTafs(b)))];
  const sig = String(sheet.sig_wx ?? "");
  return { taf, firs: sigmetUnreadFirs(sig), noTime: sig.includes(SIGMET_NO_TIME) };
}

export const needsAttention = (a: BriefingAttention) => a.taf.length > 0 || a.firs.length > 0 || a.noTime;

/** Compact code carried by the edit form and the scan endpoint: `taf:VVBM,VVCR|fir:WAAF|time`. */
export function attentionCode(a: BriefingAttention): string {
  return [a.taf.length ? `taf:${a.taf.join(",")}` : "", a.firs.length ? `fir:${a.firs.join(",")}` : "", a.noTime ? "time" : ""].filter(Boolean).join("|");
}

/** Dispatcher wording of a code, shared with the tool page. */
export function attentionLabel(code: string): string {
  const out: string[] = [];
  for (const part of String(code || "").split("|")) {
    if (part.indexOf("taf:") === 0) out.push("thiếu TAF " + part.slice(4).split(",").join(" "));
    else if (part.indexOf("fir:") === 0) out.push("chưa đọc được SIGMET " + part.slice(4).split(",").join(" "));
    else if (part === "time") out.push("chưa kiểm SIGMET (thiếu giờ bay)");
  }
  return out.join(" · ");
}

const CSS = `<style>
#tlEditBrief{position:relative;overflow:visible}
#tlEditBrief .bf-attn-badge{position:absolute;top:-9px;right:-7px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  background:#dc2626;color:#fff;font:800 11px/18px system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff;pointer-events:none}
.tool-row:has(#tlEditBrief .bf-attn-badge){overflow-y:visible}
.br-sheet-doc textarea.bf-in.bf-warn{outline:2px solid #EA580C;background:rgba(234,88,12,.10)}
.br-sheet-doc .bf-miss{color:#C2410C;font:800 10px/1.4 system-ui,sans-serif;text-align:left;margin:0 0 2px}
#bfEditPick option.bf-attn{color:#C2410C;font-weight:700}
</style>`;

/** Red badge on "Hiệu chỉnh BF" + warning labels in the flight picker; reads only what the edit form reports. */
export function patchBriefingAttentionPage(html: string): string {
  if (!html.includes('id="tlEditBrief"') || !html.includes("async function bfLoadOne(want){") || !html.includes("function bfPaintPick(){")) {
    throw new Error("Briefing edit anchor missing");
  }
  const script = `<script>(function(){
  var TTL = 10 * 60 * 1000, RETRY = 2 * 60 * 1000, scan = {}, busy = false;
  var label = ${attentionLabel.toString()};
  function codeOf(h){ var m = /data-bf-attn='([^']*)'/.exec(h || ""); return m ? m[1] : ""; }
  function tokens(){ try{ return ntCallsigns(); }catch(e){ return []; } }
  function paintBadge(){
    var btn = document.getElementById("tlEditBrief"); if(!btn) return;
    var hits = [];
    tokens().forEach(function(t){ var s = scan[t]; if(s && s.code) hits.push((s.cs || t) + ": " + label(s.code)); });
    var b = btn.querySelector(".bf-attn-badge");
    if(!hits.length){ if(b) b.remove(); btn.removeAttribute("data-attn"); return; }
    if(!b){ b = document.createElement("span"); b.className = "bf-attn-badge"; btn.appendChild(b); }
    b.textContent = String(hits.length);
    btn.setAttribute("data-attn", hits.join("\\n"));
    btn.title = "Cần bổ sung trước khi xuất:\\n" + hits.join("\\n");
  }
  function syncFromCache(){
    Object.keys(scan).forEach(function(t){
      var s = scan[t], row = s.cs && bfEditCache[s.cs];
      if(row && row.edit_html){ s.code = codeOf(row.edit_html); s.at = Date.now(); s.ok = true; }
    });
  }
  var loadOne = bfLoadOne;
  bfLoadOne = async function(want){
    var key = await loadOne(want);
    var row = bfEditCache[key];
    if(row && row.edit_html) scan[String(want).toUpperCase()] = {cs: key, code: codeOf(row.edit_html), at: Date.now(), ok: true};
    paintBadge();
    return key;
  };
  var paintPick = bfPaintPick;
  bfPaintPick = function(){
    paintPick();
    syncFromCache();
    var sel = document.getElementById("bfEditPick");
    if(sel) Array.prototype.forEach.call(sel.options, function(o){
      var row = bfEditCache[o.value], code = row && row.edit_html ? codeOf(row.edit_html) : "";
      if(!code) return;
      o.textContent = "⚠ " + o.textContent + " · " + label(code);
      o.className = "bf-attn";
    });
    paintBadge();
  };
  async function tick(){
    var list = tokens(), now = Date.now();
    Object.keys(scan).forEach(function(t){ if(list.indexOf(t) < 0) delete scan[t]; });
    paintBadge();
    if(busy || window.bfLoading || document.hidden) return;
    var due = list.filter(function(t){ var s = scan[t]; return !s || now - s.at > (s.ok ? TTL : RETRY); }).slice(0, 2);
    if(!due.length) return;
    busy = true;
    try{
      await Promise.all(due.map(async function(t){
        var prev = scan[t];
        try{
          var d = await (await fetch("/api/briefing/release", {method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({flight: t, attention_only: true})})).json();
          if(tokens().indexOf(t) < 0) return;
          if(d && !d.error && typeof d.attention === "string") scan[t] = {cs: String(d.callsign || t).toUpperCase(), code: d.attention, at: Date.now(), ok: true};
          else scan[t] = {cs: prev ? prev.cs : "", code: prev ? prev.code : "", at: Date.now(), ok: false};
        }catch(e){ scan[t] = {cs: prev ? prev.cs : "", code: prev ? prev.code : "", at: Date.now(), ok: false}; }
      }));
    }finally{ busy = false; paintBadge(); }
  }
  setInterval(tick, 4000);
})();</script>`;
  return html.replace("</head>", () => CSS + "</head>").replace(/<\/body>(?![\s\S]*<\/body>)/, () => script + "</body>");
}
