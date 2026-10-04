import { describe, expect, it } from "vitest";
import * as ds from "../defect_summary";

function mail(id: string, subject: string, received: string, sent = ""): ds.Msg {
  return { Id: id, Subject: subject, ReceivedDateTime: received, SentDateTime: sent || received };
}

describe("defect_summary", () => {
  it("subject and day", () => {
    const subj = "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT 02 SEP 2026 REV 00";
    expect(ds.isSummarySubject(subj)).toBe(true);
    expect(ds.isSummarySubject("Weekly ops summary")).toBe(false);
    expect(ds.parseReportDay(subj, { today: "2026-09-02" })).toBe("2026-09-02");
    expect(ds.parseReportDay("SUMMARY 02-SEP-26", { today: "2026-09-02" })).toBe("2026-09-02");
  });

  it("slot am/pm vietnam", () => {
    expect(ds.slotOf(new Date("2026-09-01T22:53:00Z"))).toBe("am");
    expect(ds.slotOf(new Date("2026-09-02T10:52:00Z"))).toBe("pm");
    expect(ds.formatSent(new Date("2026-09-01T22:53:00Z"))).toBe("05:53 02/09/2026");
  });

  it("parse_when prefers sent", () => {
    const when = ds.parseWhen({ SentDateTime: "2026-09-01T22:53:00Z", ReceivedDateTime: "2026-09-01T22:59:00Z" });
    expect(when).not.toBeNull();
    expect(when!.getUTCMinutes()).toBe(53);
  });

  const AM = mail("am", "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT 02 SEP 2026 REV 00", "2026-09-01T22:53:00Z");
  const PM = mail("pm", "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT 02 SEP 2026 REV 00", "2026-09-02T10:52:00Z");
  const OLD = mail("old", "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT 01 SEP 2026 REV 00", "2026-09-01T10:50:00Z");

  it("morning takes am", () => {
    const now = new Date("2026-09-02T02:17:00Z");
    const picked = ds.pickTodayMail([OLD, AM], { now });
    expect(picked?.["Id"]).toBe("am");
  });

  it("afternoon prefers pm", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const picked = ds.pickTodayMail([AM, PM, OLD], { now });
    expect(picked?.["Id"]).toBe("pm");
  });

  it("afternoon falls back to am", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    const picked = ds.pickTodayMail([AM, OLD], { now });
    expect(picked?.["Id"]).toBe("am");
  });

  it("other day is ignored", () => {
    const now = new Date("2026-09-02T02:17:00Z");
    expect(ds.pickTodayMail([OLD], { now })).toBeNull();
  });

  it("missing reports not found", () => {
    const now = new Date("2026-09-02T02:17:00Z");
    const text = ds.missingTodayMessage([], { now });
    expect(text).toContain("Không tìm thấy mail");
    expect(text).toContain("02/09/2026");
  });

  it("missing reports wrong day with sent time", () => {
    const now = new Date("2026-09-02T02:17:00Z");
    const text = ds.missingTodayMessage([OLD], { now });
    expect(text).toContain("Mail sai ngày");
    expect(text).toContain("01 SEP 2026");
    expect(text).toContain("Ngày mail gửi:");
    expect(text).toContain("17:50 01/09/2026");
  });

  it("pdf not xlsx", () => {
    const atts = [
      { Id: "xls", Name: "SUMMARY MP & OPS LIMITATION.xlsx" },
      { Id: "pdf", Name: "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT.pdf" },
    ];
    expect(ds.pickPdfAttachment(atts)?.["Id"]).toBe("pdf");
  });

  it("pdf prefers limitation list over status report", () => {
    const atts = [
      { Id: "xls", Name: "SUMMARY MP & OPS LIMITATION.xlsx" },
      { Id: "status", Name: "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT.pdf" },
      { Id: "list", Name: "SUMMARY MP & OPS LIMITATION LIST FOR OMC 03 SEP 2026.pdf" },
    ];
    expect(ds.pickPdfAttachment(atts)?.["Id"]).toBe("list");
  });

  it("pdf recognizes vjc rep prefix", () => {
    const atts = [
      { Id: "status", Name: "AIRCRAFT TECHNICAL SUMMARY STATUS REPORT.pdf" },
      { Id: "rep", Name: "VJC.REP.1000197 - SUMMARY MP.pdf" },
    ];
    expect(ds.pickPdfAttachment(atts)?.["Id"]).toBe("rep");
    expect(ds.pdfRank("VJC.REP.1000197.pdf")).toBe(0);
  });
});
