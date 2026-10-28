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
    expect(shouldDelete("regnotice/u/a.pdf", now - 13 * 3600_000, now)).toBe(true);
  });
});

import { staleOnOpen } from "../file_retention";
describe("staleOnOpen", () => {
  const now = Date.parse("2026-10-28T17:00:00Z");
  it("removes excel from earlier session", () => expect(staleOnOpen("excel/a.xlsx", now - 2 * 3600_000, now)).toBe(true));
  it("keeps files used in last 30 min", () => expect(staleOnOpen("regnotice/a.pdf", now - 10 * 60_000, now)).toBe(false));
  it("deletes own files after 1h offline", () => expect(staleOnOpen("excel/a.xlsx", now - 61 * 60_000, now)).toBe(true));
  it("keeps files within 1h", () => expect(staleOnOpen("excel/a.xlsx", now - 50 * 60_000, now)).toBe(false));
  it("never touches Notice library", () => expect(staleOnOpen("notices/a.pdf", 0, now)).toBe(false));
});
