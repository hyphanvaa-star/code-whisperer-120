/* Browser-safe state of the AGENT dot. Inlined into the tool page by the
   /tool-page shim (export keywords stripped), so keep it self-contained. */
export function agentVerTuple(v){
  const s = String(v || "").trim();
  return s ? s.split(".").map(function(p){ return /^\d+$/.test(p) ? Number(p) : 0; }) : [];
}
export function agentVerNewer(a, b){
  const x = agentVerTuple(a), y = agentVerTuple(b);
  for(let i = 0; i < Math.max(x.length, y.length); i++){
    const d = (x[i] || 0) - (y[i] || 0);
    if(d) return d > 0;
  }
  return false;
}
/* s: {online, version, latest, updateError, updateWant} → {state, label, title}
   state: off (grey) · ok (green) · old (orange, works on old version) · fail (orange, update failed) */
export function agentBadge(s){
  if(!s || !s.online) return {state: "off", label: "", title: ""};
  const have = String(s.version || "");
  const latest = String(s.latest || "");
  const want = String(s.updateWant || latest);
  if(s.updateError && agentVerNewer(want, have)){
    return {state: "fail", label: "⚠ " + have,
      title: "Trợ lý PC chưa cập nhật được lên bản " + want + " (lý do: " + s.updateError + "). Đang chạy tiếp bản " + have + " bình thường. Bấm để thử cập nhật lại."};
  }
  if(latest && agentVerNewer(latest, have)){
    return {state: "old", label: "⚠ " + have,
      title: "Trợ lý PC đang chạy bản " + have + ", web đã có bản " + latest + ". Sẽ tự cài khi bật lại trợ lý đầu ca, hoặc bấm để cập nhật ngay."};
  }
  return {state: "ok", label: "", title: ""};
}
