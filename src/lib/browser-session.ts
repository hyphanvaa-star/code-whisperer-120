// Browser-session heartbeat: every open tab refreshes a shared timestamp.
// A new tab joins while another tab is alive; once all tabs/the browser are
// closed the heartbeat goes stale, so reopening requires the password again.
//
// Chrome throttles/freezes timers in background tabs and stops them while the
// PC sleeps, so a short threshold signed dispatchers out on F5 or when
// returning to the tab. A per-tab sessionStorage marker tells "same tab
// reloaded / came back" (long grace) apart from "fresh tab after the browser
// was closed" (short grace).
const KEY = "sh_alive_hb";
const TAB_KEY = "sh_tab_alive";
/** Fresh tab (no tab marker): browser counts as closed after this gap. */
export const NEW_TAB_STALE_MS = 3 * 60_000;
/** Same tab reloaded or woken up (tab marker present). */
export const SAME_TAB_STALE_MS = 8 * 60 * 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

function beat() { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } }
function onVisible() { if (document.visibilityState === "visible") beat(); }

export function markBrowserSession() {
  beat();
  try { sessionStorage.setItem(TAB_KEY, "1"); } catch { /* ignore */ }
  if (!timer && typeof window !== "undefined") {
    timer = setInterval(beat, 5_000);
    window.addEventListener("pagehide", beat);
    window.addEventListener("pageshow", beat);
    window.addEventListener("focus", beat);
    document.addEventListener("visibilitychange", onVisible);
  }
}

export function clearBrowserSession() {
  if (timer) { clearInterval(timer); timer = null; }
  if (typeof window !== "undefined") {
    window.removeEventListener("pagehide", beat);
    window.removeEventListener("pageshow", beat);
    window.removeEventListener("focus", beat);
    document.removeEventListener("visibilitychange", onVisible);
  }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  try { sessionStorage.removeItem(TAB_KEY); } catch { /* ignore */ }
}

/** true = no tab has been alive recently (all tabs/browser were closed). */
export function browserSessionExpired(now = Date.now()): boolean {
  try {
    const t = Number(localStorage.getItem(KEY) || 0);
    if (!t) return true;
    const sameTab = sessionStorage.getItem(TAB_KEY) === "1";
    return now - t > (sameTab ? SAME_TAB_STALE_MS : NEW_TAB_STALE_MS);
  } catch {
    return false;
  }
}
