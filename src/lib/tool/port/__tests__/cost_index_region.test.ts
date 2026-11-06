import { describe, expect, it } from "vitest";
import { Db, _ci, render_fpl } from "../fpl_tool";
import raw from "../../data/fpl_tool.json";
import ciDoc from "../../data/fpl/cost_index.json";
import { airportCountry, selectCostIndexRow } from "../cost_index_region";
import { renderFpl, type FplDb } from "../../../fpl";

const db = new Db(raw, { ciDoc });
db.neo.add("VN-A646");

describe("Cost Index airport country regions", () => {
  it("Perth A321NEO uses Australia CI 18 without a manually listed PER", () => {
    expect(_ci(db, "PER", "SGN", "321", "VN-A646")).toBe("18");
    expect(_ci(db, "YPPH", "VVTS", "321", "VN-A646")).toBe("18");
    expect(render_fpl(db, { flt: "92", dep: "PER", arr: "SGN", reg: "VN-A646", ac: "321", etd: "17:30" }, {})).toContain("CRZ÷CI18");
  });

  it.each([
    ["BWN", "sea"], ["RGN", "sea"], ["LPQ", "sea"], ["SAI", "sea"],
    ["PEN", "sea"], ["SUB", "sea"], ["DVO", "sea"], ["WSAP", "sea"], ["VTBU", "sea"],
    ["CTS", "japan"], ["RKNY", "korea"], ["ZBAA", "china"],
    ["RCQC", "twhk"], ["VHHH", "twhk"], ["VMMC", "twhk"],
    ["CCU", "india"], ["CMB", "india"], ["ALA", "kz"], ["NQZ", "kz"], ["VVO", "russia"],
  ])("%s recognizes region %s without airport lists", (dep, expected) => {
    const rows = ciDoc.rows.map(row => ({ ...row, airports: [] }));
    expect(selectCostIndexRow(rows, dep, "SGN")?.id).toBe(expected);
  });

  it("Vietnam country recognition distinguishes domestic and international routes", () => {
    const rows = ciDoc.rows.map(row => ({ ...row, airports: [] }));
    expect(selectCostIndexRow(rows, "VVTS", "VVNB")?.a320).toBe("13");
    expect(selectCostIndexRow(rows, "VVTS", "YPPH")?.a321neo).toBe("19");
  });

  it("keeps the dispatcher's configured CI rather than hardcoding Australia 18", () => {
    const custom = new Db(raw, { ciDoc: { rows: ciDoc.rows.map(row => row.id === "aus" ? { ...row, a321neo: "23" } : row) } });
    custom.neo.add("VN-A646");
    expect(_ci(custom, "PER", "SGN", "321", "VN-A646")).toBe("23");
  });

  it("prioritizes explicit airport exceptions including ICAO/IATA equivalence", () => {
    const rows = [...ciDoc.rows, { id: "per-exception", airports: ["YPPH"], a321neo: "21" }];
    expect(selectCostIndexRow(rows, "PER", "SGN")?.a321neo).toBe("21");
    // Retain existing cross-country airport assignments (e.g. Mongolia in China row).
    expect(selectCostIndexRow(ciDoc.rows, "UBN", "SGN")?.id).toBe("china");
  });

  it("does not invent a CI for an unknown country, region or unsupported aircraft column", () => {
    expect(airportCountry("ZZZ")).toBe("");
    expect(selectCostIndexRow(ciDoc.rows, "ZZZ", "SGN")).toBeUndefined();
    expect(selectCostIndexRow(ciDoc.rows, "EGLL", "SGN")).toBeUndefined();
    expect(_ci(db, "PER", "SGN", "320", "VN-A000")).toBe("");
  });

  it("client FPL export applies the same Perth CI as the KHB port", () => {
    const clientDb: FplDb = {
      tlk: "", dsp: "", legendCpt2: "", legendFo: "", etp: {}, alt: {}, era: {}, tz: {},
      domestic: [], neo: ["VN-A646"], ci: ciDoc.rows, suffix: [], taxi: {}, payload: {},
      payloadDate: "", pcrDep: [], pcrHead: [], pcrGrid: [], pcrReg: {}, source: "",
    };
    const text = renderFpl(clientDb, { key: "92", flt: "92", date: "06/11/26", reg: "VN-A646", ac: "321", dep: "PER", arr: "SGN", etdUtc: "0930", staLocal: "", cptId: "", cptName: "", cpt2Id: "", cpt2Name: "", foId: "", foName: "" }, { extra: "", seq: "1", routeQ: "", etpPoa: "", fl: "", talt: "", alt1: "", alt2: "", rte: "", rmk: "", pcrTo: "", pay: "", utc: "", dsp: "" });
    expect(text).toContain("CRZ÷CI18");
  });
});