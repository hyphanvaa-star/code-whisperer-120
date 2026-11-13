import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse_japan_sup_text } from "../aip_sup";

describe("Japan SUP 176/26 Shizuhama temporary training area", () => {
  it("keeps the seven published points and ignores repeated map labels", () => {
    const text = readFileSync("src/lib/tool/port/__tests__/fixtures/jp_sup_176_26.txt", "utf8");
    const t = parse_japan_sup_text(text, "176/26");
    const ring = Object.values(t)[0]!.ring;
    expect(ring).toHaveLength(7);
    expect(ring[0]).toEqual([35.141111, 138.691944]);
    expect(ring[6]).toEqual([34.876667, 138.780278]);
  });
});
