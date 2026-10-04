import { describe, it, expect } from "vitest";
import * as taf from "../taf";

const TSN_CBO_DAWN = `
<select name="cboDatetime" id="cboDatetime">
<option value="200000082026">0000 UTC : 20-Aug-2026</option>
<option value="200300082026" selected>0300 UTC : 20-Aug-2026</option>
<option value="200600082026">0600 UTC : 20-Aug-2026</option>
<option value="200900082026">0900 UTC : 20-Aug-2026</option>
<option value="201200082026">1200 UTC : 20-Aug-2026</option>
<option value="201500082026">1500 UTC : 20-Aug-2026</option>
<option value="201800082026">1800 UTC : 20-Aug-2026</option>
<option value="202100082026">2100 UTC : 20-Aug-2026</option>
<option value="200600082026">0600 UTC : 20-Aug-2026</option>
</select>`;

const TSN_CBO_NOW = `
<select name="cboDatetime" id="cboDatetime">
<option value="200000082026">0000 UTC : 20-Aug-2026</option>
<option value="200300082026">0300 UTC : 20-Aug-2026</option>
<option value="200600082026">0600 UTC : 20-Aug-2026</option>
<option value="200900082026" selected>0900 UTC : 20-Aug-2026</option>
<option value="201200082026">1200 UTC : 20-Aug-2026</option>
<option value="201500082026">1500 UTC : 20-Aug-2026</option>
<option value="201800082026">1800 UTC : 20-Aug-2026</option>
<option value="202100082026">2100 UTC : 20-Aug-2026</option>
<option value="201200082026">1200 UTC : 20-Aug-2026</option>
</select>`;

describe("taf datetime slot parsing", () => {
  it("parses cbo slot", () => {
    const dt = taf.parseCboSlot("200300082026");
    expect(dt?.toISOString()).toBe(new Date(Date.UTC(2026, 7, 20, 3, 0)).toISOString());
    expect(taf.parseCboSlot("0300 UTC : 20-Aug-2026")).toBeNull();
    expect(taf.parseCboSlot("")).toBeNull();
  });

  it("last row is newest, not the selected clock", () => {
    const opts = taf.datetimeOptions(TSN_CBO_DAWN);
    expect(opts[0]).toBe("200600082026");
    expect(opts).toEqual(["200600082026", "200300082026", "200000082026"]);
  });

  it("afternoon last row 1200 beats selected 0900", () => {
    const opts = taf.datetimeOptions(TSN_CBO_NOW);
    expect(opts[0]).toBe("201200082026");
    expect(opts).toEqual(["201200082026", "200900082026", "200600082026", "200300082026", "200000082026"]);
    expect(opts).not.toContain("201500082026");
    expect(opts).not.toContain("202100082026");
  });

  it("placeholder hours after last row are dropped", () => {
    const opts = taf.datetimeOptions(TSN_CBO_DAWN);
    expect(opts).not.toContain("200900082026");
    expect(opts).not.toContain("201200082026");
  });

  it("old newest-first html still works", () => {
    const html = `
    <select name="cboDatetime">
    <option value="201800082026" selected>1800 UTC : 20-Aug-2026</option>
    <option value="201500082026">1500 UTC : 20-Aug-2026</option>
    <option value="201200082026">1200 UTC : 20-Aug-2026</option>
    </select>`;
    expect(taf.datetimeOptions(html)).toEqual(["201800082026", "201500082026", "201200082026"]);
  });

  it("missing select returns empty", () => {
    expect(taf.datetimeOptions("<html></html>")).toEqual([]);
  });
});
