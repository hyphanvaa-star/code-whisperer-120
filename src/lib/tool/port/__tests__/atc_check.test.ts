import { describe, it, expect } from "vitest";
import { missingDetailReason, fplCallsign, fplIsFor } from "../atc_check";

describe("missingDetailReason", () => {
  it("reading any field counts as checked", () => {
    expect(missingDetailReason({ callsign: "VJC424", status: "Filed", reg: "VN-A629" }, "REG/VN-A629")).toBe("");
    expect(missingDetailReason({ callsign: "VJC424", status: "Filed", dof: "260814" }, "x")).toBe("");
    expect(missingDetailReason({ callsign: "VJC424", status: "Filed", flightTime: "1320" }, "x")).toBe("");
  });
  it("status alone is not a successful check", () => {
    const r = missingDetailReason({ callsign: "VJC424", status: "Closed" }, "");
    expect(r).toContain("không đọc được nội dung FPL");
  });
  it("an empty flight plan says so", () => {
    const r = missingDetailReason({ callsign: "VJC424", status: "Closed" }, "VJC424 SGN HAN\nsomething");
    expect(r).toContain("không có REG/DOF/EOBT");
  });
});

const FPL_150 = "(FPL-VJC150-IS\n-A321/M-SDE2E3FGHIRWXY/LB1\n-VVTS1040\n-REG/VNA641 DOF/260915)\n";
const FPL_1831 = "(FPL-VJC1831-IS\n-A321/M-SDE2E3FGHIRWXY/LB1\n-VVTS0925\n-REG/VNA677 DOF/260915)\n";

describe("fplCallsign / fplIsFor", () => {
  it("reads callsign from FPL block", () => {
    expect(fplCallsign(FPL_150)).toBe("VJC150");
    expect(fplCallsign(FPL_1831)).toBe("VJC1831");
    expect(fplCallsign("")).toBe("");
  });
  it("VJC150 does not accept previous flight FPL", () => {
    expect(fplIsFor(FPL_150, "VJC150")).toBe(true);
    expect(fplIsFor(FPL_1831, "VJC150")).toBe(false);
    expect(fplIsFor(FPL_150, "VJC1831")).toBe(false);
  });
});
