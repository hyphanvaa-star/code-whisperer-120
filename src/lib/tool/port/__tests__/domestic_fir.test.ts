import { test, expect } from "vitest";
import { fplFirs } from "/dev-server/src/lib/tool/port/ofp_weights";
import { srEvaluate } from "/dev-server/src/lib/special-rules";
test("domestic via VLVT", () => {
  const firs = fplFirs("x (FPL-VJC123-IS\n-A321/M-S/C\n-VVTS0100\n-N0450F330 DCT\n-VVNB0150\n-PBN/A1 DOF/261021 EET/VVHM0010 VLVT0040\n VVHN0100 REG/VNA629)");
  expect(firs).toEqual(["VVHM","VLVT","VVHN"]);
  const h = srEvaluate({ rule:"DOMESTIC_ONLY", acs:["VNA629"] } as any, { reg:"VNA629", dep:"VVTS", dest:"VVNB", firs } as any, []);
  expect(h.length).toBe(1);
});
