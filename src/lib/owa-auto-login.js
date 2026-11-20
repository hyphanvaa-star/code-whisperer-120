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
