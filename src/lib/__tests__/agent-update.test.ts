import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser JS module
import { agentBadge, agentUpdateStep, agentVerNewer } from "../agent-update.js";

describe("agentBadge", () => {
  it("compares versions numerically (6.13 is newer than 6.9)", () => {
    expect(agentVerNewer("6.13", "6.9")).toBe(true);
    expect(agentVerNewer("6.12", "6.12")).toBe(false);
    expect(agentVerNewer("6.11", "6.12")).toBe(false);
  });

  it("offline helper stays grey", () => {
    expect(agentBadge({ online: false, version: "6.11", latest: "6.13" }).state).toBe("off");
  });

  it("helper on an older version than the web shows the orange label", () => {
    const b = agentBadge({ online: true, version: "6.12", latest: "6.13" });
    expect(b.state).toBe("old");
    expect(b.label).toBe("⚠ 6.12");
  });

  it("failed self-update is reported with its reason", () => {
    const b = agentBadge({ online: true, version: "6.12", latest: "6.13", updateError: "mất mạng", updateWant: "6.13" });
    expect(b.state).toBe("fail");
    expect(b.title).toContain("mất mạng");
  });

  it("an old failure is ignored once the helper reached that version", () => {
    expect(agentBadge({ online: true, version: "6.13", latest: "6.13", updateError: "mất mạng", updateWant: "6.13" }).state).toBe("ok");
  });
});

describe("agentUpdateStep (AGENT update button)", () => {
  it("a busy old helper is retried quietly, never shown as an alert", () => {
    expect(agentUpdateStep({ ok: false, reason: "busy" }, 0).action).toBe("retry");
    expect(agentUpdateStep({ ok: false, reason: "busy" }, 39).action).toBe("retry");
  });

  it("gives up after 40 quiet retries and asks for one Bat-Tro-Ly double-click", () => {
    const s = agentUpdateStep({ ok: false, reason: "busy" }, 40);
    expect(s.action).toBe("fail");
    expect(s.msg).toContain("Bat-Tro-Ly");
  });

  it("a helper finishing its current job first reports waiting, not busy", () => {
    expect(agentUpdateStep({ ok: true, reason: "queued" }, 0).action).toBe("wait");
  });

  it("an idle helper updates straight away", () => {
    expect(agentUpdateStep({ ok: true, reason: "" }, 0).action).toBe("done");
  });

  it("an unreachable helper fails with guidance", () => {
    expect(agentUpdateStep(null, 0).action).toBe("fail");
  });
});
