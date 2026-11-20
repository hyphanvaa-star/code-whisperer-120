import { beforeEach, describe, expect, it } from "vitest";
import { browserSessionExpired, clearBrowserSession, markBrowserSession } from "@/lib/browser-session";

const MIN = 60_000;
beforeEach(() => { clearBrowserSession(); localStorage.clear(); sessionStorage.clear(); });

describe("Browser session heartbeat", () => {
  it("keeps a reloaded tab signed in after 2 hours of a frozen/sleeping background tab", () => {
    markBrowserSession();
    clearBrowserSession(); localStorage.setItem("sh_alive_hb", String(Date.now()));
    sessionStorage.setItem("sh_tab_alive", "1");
    expect(browserSessionExpired(Date.now() + 120 * MIN)).toBe(false);
  });

  it("keeps a new tab signed in while another tab beat 2 minutes ago", () => {
    localStorage.setItem("sh_alive_hb", String(Date.now()));
    expect(browserSessionExpired(Date.now() + 2 * MIN)).toBe(false);
  });

  it("asks for the password in a fresh tab after the browser was closed for 5 minutes", () => {
    localStorage.setItem("sh_alive_hb", String(Date.now()));
    expect(browserSessionExpired(Date.now() + 5 * MIN)).toBe(true);
  });

  it("asks for the password when no heartbeat exists", () => {
    expect(browserSessionExpired()).toBe(true);
  });
});
