import { test, expect } from "vitest";
import { fplFirs } from "../ofp_weights";
import { srEvaluate } from "../../../special-rules";
test("domestic via VLVT", () => {
  const firs = fplFirs("x (FPL-VJC123-IS\n-A321/M-S/C\n-VVTS0100\n-N0450F330 DCT\n-VVNB0150\n-PBN/A1 DOF/261021 EET/VVHM0010 VLVT0040\n VVHN0100 REG/VNA629)");
  expect(firs).toEqual(["VVHM","VLVT","VVHN"]);
  const h = srEvaluate({ rule:"DOMESTIC_ONLY", acs:["REG:VNA629"] }, { reg:"VNA629", dep:"VVTS", dest:"VVNB", firs }, []);
  expect(h.length).toBe(1);
});
