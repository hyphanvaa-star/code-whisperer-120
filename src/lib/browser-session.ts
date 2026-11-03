// Browser-session marker: a cookie with no expiry is shared by all tabs and
// dropped when the browser closes, so reopening requires the password again.
const NAME = "sh_alive";
const attrs = () =>
  `path=/; SameSite=${location.protocol === "https:" ? "None; Secure" : "Lax"}`;

export function markBrowserSession() {
  try { document.cookie = `${NAME}=1; ${attrs()}`; } catch { /* ignore */ }
}

export function clearBrowserSession() {
  try { document.cookie = `${NAME}=; max-age=0; ${attrs()}`; } catch { /* ignore */ }
}

/** true = browser was closed since login (cookie gone) and cookies work. */
export function browserSessionExpired(): boolean {
  try {
    if (document.cookie.split("; ").some((c) => c === `${NAME}=1`)) return false;
    document.cookie = `sh_probe=1; ${attrs()}`;
    const ok = document.cookie.includes("sh_probe=1");
    document.cookie = `sh_probe=; max-age=0; ${attrs()}`;
    return ok; // if cookies are blocked, never force a sign-out
  } catch {
    return false;
  }
}
