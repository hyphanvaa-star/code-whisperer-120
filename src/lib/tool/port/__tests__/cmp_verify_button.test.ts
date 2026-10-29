import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { patchCmpValidationPage } from "../cmp_validation";

const page = patchCmpValidationPage(readFileSync("src/tool/page.html", "utf8"));
const renderStart = page.indexOf("function render(){");
const renderBody = page.slice(renderStart, renderStart + 2200);
const verifyCell = page.slice(page.indexOf("const existingVerify = vVerifyCell(actionRow);"));

describe("verify button placement", () => {
  it("keeps every embedded script valid after applying the shim", () => {
    const scripts = [...page.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Script(script[1] ?? "")).not.toThrow();
  });

  it("never puts a verify button in the flight board callsign cell", () => {
    expect(renderStart).toBeGreaterThan(-1);
    expect(renderBody).not.toContain("csQuickVerify");
    expect(page).not.toContain("cs-vf");
    expect(page).not.toContain("td[0].prepend(vb)");
  });

  it("puts the quick verify button in the compare VERIFY column", () => {
    expect(page).toContain("const existingVerify = vVerifyCell(actionRow);");
    expect(verifyCell).toContain('quick.className = "cmp-vf"');
    expect(verifyCell).toContain("csQuickVerify(actionFlight, quick");
    expect(verifyCell.slice(0, 2500)).toContain("verifyCell.prepend(quick)");
  });

  it("marks the compare row verified only when the run finished successfully", () => {
    const done = verifyCell.slice(verifyCell.indexOf("csQuickVerify(actionFlight, quick"),
      verifyCell.indexOf("verifyCell.prepend(quick)"));
    expect(done).toContain("if(!ok) return;");
    expect(done).toContain("actionRow.ofp_ack = false");
    expect(done).toContain('vMarkDone("verify", actionRow, quick)');
  });
});
