// Port of tests/test_handover.py (HandoverModuleTests). HandoverPageTests is
// skipped: it only asserts strings exist verbatim in web.py's PAGE html/JS,
// which src/tool/page.html already serves unchanged.
import { describe, expect, it } from "vitest";
import { normalize, xlsxBytes, xlsxFilename } from "../handover";

describe("handover", () => {
  it("normalize keeps shift and notes", () => {
    const data = normalize({
      shift: "CA 2",
      date: "2026-10-03",
      from_dsp: "PHAN THANH HY",
      to_dsp: "CA SAU",
      flights: [
        {
          callsign: "VJC828",
          dep: "SGN",
          arr: "HAN",
          ac: "330",
          std: "0100Z",
          note: "delay slot",
        },
      ],
    });
    expect(data.shift).toBe("NIGHT SHIFT");
    expect(data.flights[0].callsign).toBe("VJC828");
    expect(data.flights[0].note).toBe("delay slot");
    expect(data.flights[0].key.startsWith("VJC828")).toBe(true);
  });

  it("xlsx has headers and title", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const blob = await xlsxBytes({
      shift: "MORNING SHIFT",
      date: "2026-10-03",
      flights: [{ callsign: "VJC150", dep: "SGN", arr: "DAD", ac: "321", std: "0200Z", atc: "OK" }],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(blob as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("I1").value).toBe("MORNING SHIFT HANDOVER");
    expect(ws.getCell(3, 1).value).toBe("CHUYẾN BAY");
    expect(ws.getCell(3, 12).value).toBe("NOTE");
    expect(ws.getCell(4, 1).value).toBe("VJC150");
    expect(ws.getCell(4, 9).value).toBe("OK");

    expect(xlsxFilename({ shift: "MORNING SHIFT", date: "2026-10-03" })).toContain("MORNING_SHIFT_HANDOVER");
    expect(xlsxFilename({ shift: "NIGHT SHIFT", date: "2026-10-03" })).toContain("NIGHT_SHIFT_HANDOVER");
  });
});
