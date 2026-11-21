import { describe, expect, it } from "vitest";
// @ts-expect-error plain browser JS module
import { agentBadge, agentVerNewer } from "../agent-update.js";

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
