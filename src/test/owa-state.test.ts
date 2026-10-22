import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const raw = readFileSync("src/tool/page.html", "utf8");
const shim = readFileSync("src/routes/tool-page.ts", "utf8");
const start = shim.indexOf("    // Watcher inactivity");
const end = shim.indexOf('    .replace("    if(ok) await defPullSummary', start);
const transformed: string = runInNewContext("raw\n" + shim.slice(start, end), { raw });
const poll = transformed.match(/async function fplWatchPoll\(\)\{[\s\S]*?(?=\nfunction fplWatchStartUi)/)?.[0];
if (!poll) throw new Error("Missing FPL polling function");

describe("Outlook Web passive status", () => {
  it("does not invalidate verified login when FPL stops for token age", async () => {
    const states: string[] = [];
    const context = { fetch: async () => ({ json: async () => ({ running: false, lines: [] }) }),
      fplAfter: 0, $: () => null, paintDlClocks: () => {}, setOwaState: (s: string) => states.push(s) };
    await runInNewContext(poll + "\nfplWatchPoll()", context);
    expect(states).toEqual([]);
  });

  it("does not overwrite an active authentication error", async () => {
    const context = { state: "stale", fetch: async () => ({ json: async () => ({ running: false, lines: [] }) }),
      fplAfter: 0, $: () => null, paintDlClocks: () => {}, setOwaState: () => { context.state = "healthy"; } };
    await runInNewContext(poll + "\nfplWatchPoll()", context);
    expect(context.state).toBe("stale");
  });
});