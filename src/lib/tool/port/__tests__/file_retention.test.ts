import { describe, it, expect } from "vitest";
import { shouldDelete } from "../file_retention";

// 2026-10-22 21:00 Vietnam time
const now = Date.UTC(2026, 9, 22, 14, 0);
const vn = (d: number, h = 12) => Date.UTC(2026, 9, d, h - 7);

describe("file retention", () => {
  it("keeps Excel from 21/10 onward on 22/10", () => {
    expect(shouldDelete("excel/u/x/a.xlsx", vn(21, 0), now)).toBe(false);
    expect(shouldDelete("excel/u/x/a.xlsx", vn(22), now)).toBe(false);
  });
  it("deletes Excel from 20/10 and before", () => {
    expect(shouldDelete("excel/u/x/a.xlsx", vn(20, 23), now)).toBe(true);
  });
  it("deletes exports after 2h", () => {
    expect(shouldDelete("atc/a.txt", now - 3 * 3600_000, now)).toBe(true);
    expect(shouldDelete("atc/a.txt", now - 3600_000, now)).toBe(false);
  });
  it("deletes session PDFs after 12h", () => {
    expect(shouldDelete("notices-tmp/u/s/a.pdf", now - 13 * 3600_000, now)).toBe(true);
  });
  it("keeps split MEL through a 13h shift, drops it after 24h", () => {
    expect(shouldDelete("regnotice/u/VNA643.pdf", now - 13 * 3600_000, now)).toBe(false);
    expect(shouldDelete("regnotice/u/VNA643.pdf", now - 25 * 3600_000, now)).toBe(true);
  });
});

import { staleOnOpen } from "../file_retention";
describe("staleOnOpen", () => {
  const now = Date.parse("2026-10-28T17:00:00Z");
  it("removes excel from earlier session (3h old)", () => expect(staleOnOpen("excel/a.xlsx", now - 3 * 3600_000, now)).toBe(true));
  it("keeps files used in last 30 min", () => expect(staleOnOpen("excel/a.xlsx", now - 10 * 60_000, now)).toBe(false));
  it("drops previous-shift split MEL once web was closed over 2h", () => expect(staleOnOpen("regnotice/u/VNA643.pdf", now - 2 * 3600_000 - 60_000, now)).toBe(true));
  it("keeps split MEL within 2h", () => expect(staleOnOpen("regnotice/u/VNA643.pdf", now - 110 * 60_000, now)).toBe(false));
  it("deletes own files after 2h offline", () => expect(staleOnOpen("excel/a.xlsx", now - 121 * 60_000, now)).toBe(true));
  it("keeps files within 2h", () => expect(staleOnOpen("excel/a.xlsx", now - 110 * 60_000, now)).toBe(false));
  it("never touches Notice library", () => expect(staleOnOpen("notices/a.pdf", 0, now)).toBe(false));
  it("cleans own pibwx after 2h offline", () => expect(staleOnOpen("pibwx/a.pdf", now - 121 * 60_000, now)).toBe(true));
  it("keeps pibwx within 2h", () => expect(staleOnOpen("pibwx/a.pdf", now - 90 * 60_000, now)).toBe(false));
});

import { offlineLongEnough, staleMelFiles } from "../file_retention";
describe("offline detection", () => {
  const now = Date.parse("2026-11-17T07:00:00Z");
  it("Ctrl+Shift+R while online (seen 2 min ago) is not offline", () => expect(offlineLongEnough(now - 2 * 60_000, now)).toBe(false));
  it("no open tab for 90 min is still the same shift", () => expect(offlineLongEnough(now - 90 * 60_000, now)).toBe(false));
  it("no open tab for 121 min is offline", () => expect(offlineLongEnough(now - 121 * 60_000, now)).toBe(true));
  it("crossing midnight while online is not offline (night shift)", () =>
    expect(offlineLongEnough(Date.parse("2026-11-17T16:55:00Z"), Date.parse("2026-11-17T17:05:00Z"))).toBe(false));
  it("never seen counts as offline", () => expect(offlineLongEnough(null, now)).toBe(true));
});
describe("new MEL split replaces old MEL", () => {
  it("deletes every old aircraft file not in the new split", () =>
    expect(staleMelFiles(["VNA640.pdf", "VNA643.pdf", "VNA999.pdf"], ["VNA643.pdf"])).toEqual(["VNA640.pdf", "VNA999.pdf"]));
  it("never deletes other files in the folder", () =>
    expect(staleMelFiles(["notes.pdf", "VNA64.pdf", "VNA640.xlsx"], ["VNA643.pdf"])).toEqual([]));
});
