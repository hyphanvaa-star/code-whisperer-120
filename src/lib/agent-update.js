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
      title: "Trợ lý PC: đã kết nối · bản " + have + " · cập nhật " + want + " lỗi: " + s.updateError};
  }
  if(latest && agentVerNewer(latest, have)){
    return {state: "old", label: "⚠ " + have,
      title: "Trợ lý PC: đã kết nối · bản " + have + " · có bản " + latest};
  }
  return {state: "ok", label: "", title: ""};
}
/* Reply of the helper's local /update → next step for the AGENT button.
   d: JSON reply (null when the call failed) · tries: retries already made.
   Helpers ≤ 6.15 answer "busy" while a short background job runs: retry quietly
   (every few seconds, up to 40 times) instead of telling the user to click again. */
export function agentUpdateStep(d, tries){
  if(d && d.ok && d.reason === "queued") return {action: "wait", label: "⟳ chờ lệnh xong"};
  if(d && d.ok) return {action: "done", label: "⟳ đang cập nhật"};
  if(d && d.reason === "busy"){
    if((tries || 0) < 40) return {action: "retry", label: "⟳ chờ trợ lý rảnh"};
    return {action: "fail", msg: "Trợ lý bận liên tục nên chưa cập nhật được — bấm đúp Bat-Tro-Ly một lần, nó tự lên bản mới."};
  }
  if(d && d.reason === "no_bootstrap") return {action: "fail", msg: "Máy này cài trợ lý kiểu cũ — bấm đúp Bat-Tro-Ly một lần để chuyển sang bản tự cập nhật."};
  if(d) return {action: "fail", msg: "Bản trợ lý trên máy chưa hỗ trợ cập nhật từ web — bấm đúp Bat-Tro-Ly một lần để cài bản mới."};
  return {action: "fail", msg: "Không gọi được trợ lý trên máy này — bấm đúp Bat-Tro-Ly một lần."};
}
