import { describe, expect, it } from "vitest";
import { encodeKeySegment, decodeKeySegment } from "../store.server";
describe("storage key encoding", () => {
  it("round-trips Vietnamese ATC file names as ASCII", () => {
    const name = "ATC-HN-ORG ĐÃ FIX_14.txt";
    const k = encodeKeySegment(name);
    expect(/^[\x20-\x7e]+$/.test(k)).toBe(true);
    expect(decodeKeySegment(k)).toBe(name);
    expect(encodeKeySegment("plain_file.txt")).toBe("plain_file.txt");
  });
});
