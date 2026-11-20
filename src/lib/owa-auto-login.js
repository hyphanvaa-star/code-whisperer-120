/* Browser-safe plan for the automatic Outlook Web login. Inlined into the tool
   page by the /tool-page shim (export keywords stripped), so keep it
   self-contained. */
export const OWA_AUTO_BOOT_MS = 30000;      // first try 30 s after opening the web
export const OWA_AUTO_TAB_LOCK_MS = 120000; // another tab tried recently → let it finish
/* Wait after the n-th failed automatic try in a row (needs MFA, wrong password…),
   so Chrome is not reopened on the company PC over and over. */
export function owaAutoBackoff(fails){
  if(!fails) return 0;
  if(fails === 1) return 2 * 60000;
  if(fails === 2) return 5 * 60000;
  return 15 * 60000;
}
/* s: {now, openedAt, state, busy, booted, lastTryAt, fails, otherTabAt} */
export function owaAutoPlan(s){
  const now = Number(s.now) || 0;
  if(now - (Number(s.openedAt) || 0) < OWA_AUTO_BOOT_MS) return {run: false, why: "boot-wait"};
  if(s.busy) return {run: false, why: "busy"};
  const state = String(s.state || "unknown");
  if(state === "healthy") return {run: false, why: "ok"};
  // Đang kiểm tra / chờ người xác nhận MFA trên Chrome: không mở thêm cửa sổ.
  if(state === "checking" || state === "refreshing" || state === "interactive_required") return {run: false, why: state};
  if(now - (Number(s.otherTabAt) || 0) < OWA_AUTO_TAB_LOCK_MS) return {run: false, why: "other-tab"};
  if(s.booted && now - (Number(s.lastTryAt) || 0) < owaAutoBackoff(Number(s.fails) || 0)) return {run: false, why: "backoff"};
  return {run: true, why: s.booted ? "relogin" : "boot"};
}
/* Defect summary pulled automatically once Outlook Web is OK. */
export const DEF_AUTO_COOLDOWN_MS = 30 * 60000; // any tab pulled OK recently → skip
export const DEF_AUTO_RETRY_MS = 10 * 60000;    // last automatic pull failed → wait
/* s: {now, openedAt, owaState, want, busy, dirty, lastAt, lastOk} — lastAt/lastOk shared across tabs */
export function defAutoPlan(s){
  const now = Number(s.now) || 0;
  if(!s.want) return {run: false, why: "done"};
  if(now - (Number(s.openedAt) || 0) < OWA_AUTO_BOOT_MS) return {run: false, why: "boot-wait"};
  if(String(s.owaState || "") !== "healthy") return {run: false, why: "owa-not-ok"};
  if(s.busy) return {run: false, why: "busy"};
  // Đang sửa tay bảng Tàu/Defect chưa lưu: không ghi đè.
  if(s.dirty) return {run: false, why: "editing"};
  const since = now - (Number(s.lastAt) || 0);
  if(s.lastOk && since < DEF_AUTO_COOLDOWN_MS) return {run: false, why: "recent"};
  if(!s.lastOk && since < DEF_AUTO_RETRY_MS) return {run: false, why: "retry-wait"};
  return {run: true, why: "pull"};
}
