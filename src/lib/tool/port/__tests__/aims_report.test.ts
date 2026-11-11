import { describe, expect, it } from "vitest";
import { aimsFileName, buildRunParams, exportArg, findTask, parseDayrepPage, parseViewerReportId, vnDate } from "../aims_report";

const saved = {
  DayRepState: {
    TaskId: "DayRep_old",
    mainParameters: { DateRange: { start: "2026/11/01 00:00", end: "2026/11/02 00:00" }, fromTime: "04:55:00", toTime: "04:55:00" },
    outputParameters: { chkShowCrew: 1, ExportCSV: true },
  },
};

describe("AIMS Daily Flight Schedule", () => {
  it("reads session, token and saved settings from the DAYREP page", () => {
    const html = `<script>var $USER_SESSION={uid:'DAYREPCONTROLLER|USR1:ABC',scen:''};</script>
      <script>var dayRepViewParameters=${JSON.stringify(saved)};var x={"a":"}"};</script>
      <input name=__RequestVerificationToken type=hidden value=CfDJ8tok-1>`;
    const p = parseDayrepPage(html)!;
    expect(p.uid).toBe("DAYREPCONTROLLER|USR1:ABC");
    expect(p.token).toBe("CfDJ8tok-1");
    expect((p.params["DayRepState"] as { TaskId: string }).TaskId).toBe("DayRep_old");
  });

  it("replaces only the date range and keeps the user's saved time range", () => {
    const out = buildRunParams(saved, "2026-11-11", "2026-11-12") as typeof saved;
    expect(out.DayRepState.mainParameters.DateRange).toEqual({ start: "2026/11/11 00:00", end: "2026/11/12 00:00" });
    expect(out.DayRepState.mainParameters.fromTime).toBe("04:55:00");
    expect(out.DayRepState.outputParameters.chkShowCrew).toBe(1);
    expect(out.DayRepState.outputParameters.ExportCSV).toBe(false);
    expect(saved.DayRepState.mainParameters.DateRange.start).toBe("2026/11/01 00:00");
  });

  it("applies the chosen From/To hours in AIMS format", () => {
    const out = buildRunParams(saved, "2026-11-11", "2026-11-12", "06:30", "23:15") as typeof saved;
    expect(out.DayRepState.mainParameters.fromTime).toBe("06:30:00");
    expect(out.DayRepState.mainParameters.toTime).toBe("23:15:00");
    expect(() => buildRunParams(saved, "2026-11-11", "2026-11-12", "25:00", "04:55")).toThrow();
  });

  it("rejects reversed or longer than 7-day ranges", () => {
    expect(() => buildRunParams(saved, "2026-11-12", "2026-11-11")).toThrow();
    expect(() => buildRunParams(saved, "2026-11-01", "2026-11-09")).toThrow();
  });

  it("defaults to the Vietnam calendar day", () => {
    expect(vnDate(new Date("2026-11-11T18:00:00Z"))).toBe("2026-11-12");
    expect(vnDate(new Date("2026-11-11T07:34:00Z"), 1)).toBe("2026-11-12");
  });

  it("names the file without a VER number so it stays a Crewlist", () => {
    const n = aimsFileName("2026-11-11", "2026-11-12", new Date("2026-11-11T07:34:00Z"));
    expect(n).toBe("AIMS 1111-1211 14h34.xlsx");
    expect(/\bVER\s*\d+/i.test(n)).toBe(false);
  });

  it("follows the report task and the viewer ids", () => {
    expect(findTask([{ id: "DayRep_1", status: 3, progress: 100, link: "/PrintReport?taskid=DayRep_1", error: "" }], "DayRep_1")?.link).toBe("/PrintReport?taskid=DayRep_1");
    expect(findTask([{ id: "other", status: 3 }], "DayRep_1")).toBeNull();
    expect(parseViewerReportId('var viewerModel={"reportId":"04a3d93c37570cd4eb8c42b7a9d66e5b","reportUrl":""}')).toBe("04a3d93c37570cd4eb8c42b7a9d66e5b");
    expect(JSON.parse(exportArg("doc1")).format).toBe("xlsx");
  });
});
