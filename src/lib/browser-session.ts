// Browser-session heartbeat: every open tab refreshes a shared timestamp.
// A new tab joins while another tab is alive; once all tabs/the browser are
// closed the heartbeat goes stale, so reopening requires the password again.
// (Session cookies/sessionStorage are restored by "continue where you left off".)
const KEY = "sh_alive_hb";
const STALE_MS = 20_000;
let timer: ReturnType<typeof setInterval> | null = null;

function beat() { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } }

export function markBrowserSession() {
  beat();
  if (!timer && typeof window !== "undefined") {
    timer = setInterval(beat, 5_000);
    window.addEventListener("pagehide", beat);
  }
}

export function clearBrowserSession() {
  if (timer) { clearInterval(timer); timer = null; }
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** true = no tab has been alive recently (all tabs/browser were closed). */
export function browserSessionExpired(): boolean {
  try {
    const t = Number(localStorage.getItem(KEY) || 0);
    return !t || Date.now() - t > STALE_MS;
  } catch {
    return false;
  }
}
