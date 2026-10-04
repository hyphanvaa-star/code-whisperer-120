import { describe, expect, it } from "vitest";
import { extractFromTables, extractOpsLimit, groupRows, headerColumns, legacyExcelRows } from "../defect_pdf";

const A643_ACTION = `ELEC GEN 1 FAULT AFTER START BOTH ENGINE ON GROUND
[MP]: THE APU OIL QUANTITY IS CHECKED TO BE ADEQUATE BEFORE EACH FLIGHT
[OPS]:
- THE FLIGHT ALTITUDE IS LIMITED TO 33 500 FT
- THE APU AND AC AUXILIARY GENERATION ARE OPERATIVE AND USED THROUGHOUT THE FLIGHT
- MAXIMUM LANDING CAPABILITY IS CAT 3 SINGLE
`;

describe("defect_pdf", () => {
  it("header lookup and ops extraction", () => {
    const header = ["TYPE", "REMARK", "ACTION REQUIREMENT", "TOGO", "AC\nREG", "DEFECT"];
    expect(headerColumns(header)).toEqual({ action: 2, reg: 4, defect: 5 });

    const limit = extractOpsLimit(A643_ACTION);
    expect(limit.split("\n")).toEqual([
      "THE FLIGHT ALTITUDE IS LIMITED TO 33 500 FT",
      "THE APU AND AC AUXILIARY GENERATION ARE OPERATIVE AND USED THROUGHOUT THE FLIGHT",
      "MAXIMUM LANDING CAPABILITY IS CAT 3 SINGLE",
    ]);
    expect(limit).not.toContain("[MP]");
    expect(limit).not.toContain("OIL QUANTITY");
  });

  it("no ops is blank and group_rows deduplicates exact records", () => {
    expect(extractOpsLimit("DEFECT [MP]: CHECK DAILY")).toBe("");
    const limit = extractOpsLimit(A643_ACTION);
    const rows = [
      { reg: "A643", defect: "ELEC GEN 1 FAULT", limit },
      { reg: "VN-A643", defect: "ELEC GEN 1 FAULT", limit },
      { reg: "A643", defect: "AUTO FLT RUD TRIM2 FAULT", limit: "CAT 3 SINGLE" },
      { reg: "A650", defect: "CABIN SEAT", limit: "" },
    ];
    const grouped = groupRows(rows);
    expect(grouped).toHaveLength(3);
    expect(grouped.map((r) => r.reg)).toEqual(["VN-A643", "VN-A643", "VN-A650"]);
    expect(grouped[grouped.length - 1]!.limit).toBe("");
  });

  it("pdfplumber-style table extraction uses named columns and never imports remark", () => {
    const table = [
      ["TYPE", "REMARK", "ACTION REQUIREMENT", "AC REG", "DEFECT"],
      ["MP", "RPL IDG BY TECHNICIAN", A643_ACTION, "A643", "ELEC GEN 1 FAULT"],
      ["OPS PROC", "MORE MAINTENANCE", A643_ACTION, "A643", "ELEC GEN 1 FAULT"],
      ["MP", "CABIN WORK", "[MP]: MONITOR", "A650", "CABIN SEAT"],
    ];
    const rows = extractFromTables([table]);
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain("RPL IDG");
    const grouped = groupRows(rows);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.limit).toContain("33 500 FT");
    expect(grouped[1]!.limit).toBe("");
  });

  it("excel keeps legacy two columns and one row per aircraft", () => {
    const parsed = [
      { reg: "VN-A643", defect: "ELEC GEN", limit: "33 500 FT\nCAT 3 SINGLE" },
      { reg: "VN-A643", defect: "RUD TRIM", limit: "CAT 3 SINGLE" },
      { reg: "VN-A650", defect: "CABIN SEAT", limit: "" },
    ];
    const rows = legacyExcelRows(parsed);
    expect(rows).toEqual([
      ["VN-A643", "ELEC GEN - RUD TRIM"],
      ["VN-A650", "CABIN SEAT"],
    ]);
  });
});
