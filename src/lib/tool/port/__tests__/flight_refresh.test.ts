import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { patchFlightRefreshPage } from "../flight_refresh";

const page = patchFlightRefreshPage(readFileSync("src/tool/page.html", "utf8"));
const code = page.slice(page.indexOf("let toolFlightRevision = 0;"), page.indexOf("// Đổi bộ lọc", page.indexOf("let toolFlightRevision = 0;")));
function harness(fetch: (url: string) => Promise<unknown>) {
  const context = { fetch, URLSearchParams, console, allFlights: [{ id: 394 }], flights: [{ id: 1 }], OPS_BACK_H: 6, BOARD_BACK_H: 6, OPS_AHEAD_H: 24, BOARD_AHEAD_H: 24, NM_FLT_AHEAD_H: 24 };
  return { context, api: runInNewContext(code + "\n({syncToolFlights, keepFlightSelection})", context) };
}
const response = (flights: unknown[]) => ({ ok: true, json: async () => ({ flights }) });

describe("flight catalogue refresh", () => {
  it("always requests fresh unfiltered flights in −6/+24 hours", async () => {
    let query = "";
    const { api, context } = harness(async url => { query = url; return response([{ id: 394 }]); });
    await api.syncToolFlights(false);
    const p = new URL(query, "https://example.test").searchParams;
    expect(p.get("refresh")).toBe("1");
    expect(p.get("back")).toBe("6");
    expect(p.get("ahead")).toBe("24");
    expect(p.has("dispatcher")).toBe(false);
    expect(context.allFlights).toEqual([{ id: 394 }]);
  });
  it("a failed request never substitutes the filtered board", async () => {
    const { api, context } = harness(async () => ({ ok: false }));
    await api.syncToolFlights(true);
    expect(context.allFlights).toEqual([{ id: 394 }]);
  });
  it("ignores an older response that arrives after the latest refresh", async () => {
    let release: (value: unknown) => void = () => {};
    let n = 0;
    const { api, context } = harness(async () => ++n === 1 ? new Promise(r => { release = r; }) : response([{ id: 852 }]));
    const older = api.syncToolFlights(false);
    await api.syncToolFlights(true);
    release(response([{ id: 394 }]));
    await older;
    expect(context.allFlights).toEqual([{ id: 852 }]);
  });
  it("keeps a temporarily missing DSP selected, without making it an active option", () => {
    const { api } = harness(async () => response([]));
    const sel = document.createElement("select");
    sel.add(new Option("Tất cả", ""));
    const previous = new Option("PHAN THANH HY", "PHAN THANH HY");
    api.keepFlightSelection(sel, previous.value, previous);
    expect(sel.value).toBe("PHAN THANH HY");
    expect(sel.selectedOptions[0]?.disabled).toBe(true);
  });
  it("allows an authoritative empty catalogue to clear rows", async () => {
    const { api, context } = harness(async () => response([]));
    await api.syncToolFlights(true);
    expect(context.allFlights).toEqual([]);
  });
});