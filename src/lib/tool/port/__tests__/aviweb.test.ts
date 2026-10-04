import { describe, it, expect } from "vitest";
import {
  fplCallsign, fplIsFor, missingDetailReason, readFplBlocks, fplName, fplRoute,
  vaadinView, pageLooksLikeFpl, hrefIsPageLink, getAviwebCredentials,
} from "../aviweb";

// Ported from tests/test_atc_check_verdict.py (MissingDetailReasonTests,
// FplBelongsToFlightTests) and the parsing-only parts of
// tests/test_atcfpl_widgetset.py. Chrome-profile / filesystem / Selenium
// plumbing tests (AcceptWidgetsetTests, WaitLoginFormTests, SubmitUsesCacheTests,
// CheckFlightsWiringTests which asserts against atc_check.py source text) are
// skipped per the porting brief — they exercise a live Chrome session this
// runtime cannot have.

function kq(over: Partial<Parameters<typeof missingDetailReason>[0]> = {}) {
  return { callsign: "VJC424", ...over };
}

describe("missingDetailReason", () => {
  it("reading any field counts as checked", () => {
    expect(missingDetailReason(kq({ status: "Filed", reg: "VN-A629" }), "REG/VN-A629")).toBe("");
    expect(missingDetailReason(kq({ status: "Filed", dof: "260814" }), "REG/VN-A629")).toBe("");
    expect(missingDetailReason(kq({ status: "Filed", flight_time: "1320" }), "REG/VN-A629")).toBe("");
  });

  it("status alone is not a successful check (VJC424 case)", () => {
    const ly_do = missingDetailReason(kq({ status: "Closed" }), "");
    expect(ly_do).toBeTruthy();
    expect(ly_do).toContain("không đọc được nội dung FPL");
  });

  it("an empty flight plan says so", () => {
    const ly_do = missingDetailReason(kq({ status: "Closed" }), "VJC424 SGN HAN\nsomething");
    expect(ly_do).toBeTruthy();
    expect(ly_do).toContain("không có REG/DOF/EOBT");
  });

  it("the two reasons are told apart", () => {
    expect(missingDetailReason(kq(), "")).not.toBe(missingDetailReason(kq(), "có nội dung"));
  });
});

describe("FPL belongs to flight (stale View protection)", () => {
  const FPL_150 =
    "(FPL-VJC150-IS\n" +
    "-A321/M-SDE2E3FGHIRWXY/LB1\n" +
    "-VVTS1040\n" +
    "-REG/VNA641 DOF/260915)\n";
  const FPL_1831 =
    "(FPL-VJC1831-IS\n" +
    "-A321/M-SDE2E3FGHIRWXY/LB1\n" +
    "-VVTS0925\n" +
    "-REG/VNA677 DOF/260915)\n";

  it("reads callsign from fpl block", () => {
    expect(fplCallsign(FPL_150)).toBe("VJC150");
    expect(fplCallsign(FPL_1831)).toBe("VJC1831");
    expect(fplCallsign("")).toBe("");
  });

  it("VJC150 does not accept previous flight's FPL", () => {
    expect(fplIsFor(FPL_150, "VJC150")).toBe(true);
    expect(fplIsFor(FPL_1831, "VJC150")).toBe(false);
    expect(fplIsFor(FPL_150, "VJC1831")).toBe(false);
  });
});

// ---- atcfpl.py block-parsing helpers (readFplBlocks/fplName/fplRoute) ----
describe("readFplBlocks / fplName / fplRoute", () => {
  const SAMPLE =
    "some banner text\n\n" +
    "(FPL-VJC150-IS\n" +
    "-A321/M-SDE2E3FGHIRWXY/LB1\n" +
    "-WSSS0315\n" +
    "-N0450F330 DCT\n" +
    "-VVDN0225 VVCR VVPB\n" +
    "-REG/VNA641 DOF/260915)\n" +
    "\n" +
    "trailing noise, not a block\n";

  it("extracts only well-formed ATC blocks", () => {
    const blocks = readFplBlocks(SAMPLE);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.startsWith("(FPL-VJC150-")).toBe(true);
  });

  it("names and routes a block", () => {
    const [block] = readFplBlocks(SAMPLE);
    expect(fplName(block!)).toBe("VJC150");
    expect(fplRoute(block!)).toBe("WSSS→VVDN 0315");
  });

  it("strips a leading BOM", () => {
    const withBom = "\uFEFF" + SAMPLE;
    expect(readFplBlocks(withBom)).toEqual(readFplBlocks(SAMPLE));
  });
});

// ---- atcfpl.py Vaadin view / link helpers ----
describe("vaadinView / pageLooksLikeFpl / hrefIsPageLink", () => {
  it("reads the view name after # or #!", () => {
    expect(vaadinView("https://aviweb.vnaic.vn/AviWeb/#lfplf")).toBe("lfplf");
    expect(vaadinView("https://aviweb.vnaic.vn/AviWeb/#!fplf")).toBe("fplf");
    expect(vaadinView("https://aviweb.vnaic.vn/AviWeb/")).toBe("");
  });

  it("recognises the FPL filing list and dialog, not the login page", () => {
    expect(pageLooksLikeFpl("https://aviweb.vnaic.vn/AviWeb/#lfplf")).toBe(true);
    expect(pageLooksLikeFpl("https://aviweb.vnaic.vn/AviWeb/#!fplf")).toBe(true);
    expect(pageLooksLikeFpl("https://aviweb.vnaic.vn/AviWeb/login#!aaa-login")).toBe(false);
    expect(pageLooksLikeFpl("http://aviweb.vnaic.vn/AviWeb/#lfplf")).toBe(false);
  });

  it("tells internal FPL navigation apart from page-leaving links", () => {
    expect(hrefIsPageLink("#lfplf")).toBe(false);
    expect(hrefIsPageLink("javascript:void(0)")).toBe(false);
    expect(hrefIsPageLink("http://aviweb.vnaic.vn/AviWeb/#lfplf")).toBe(true);
    expect(hrefIsPageLink("https://aviweb.vnaic.vn/AviWeb/dashboard")).toBe(true);
    expect(hrefIsPageLink("https://aviweb.vnaic.vn/AviWeb/#lfplf")).toBe(false);
  });
});

describe("getAviwebCredentials", () => {
  it("returns null when either env var is missing", () => {
    const prevUser = process.env["AVIWEB_USERNAME"];
    const prevPass = process.env["AVIWEB_PASSWORD"];
    delete process.env["AVIWEB_USERNAME"];
    delete process.env["AVIWEB_PASSWORD"];
    expect(getAviwebCredentials()).toBeNull();
    if (prevUser !== undefined) process.env["AVIWEB_USERNAME"] = prevUser;
    if (prevPass !== undefined) process.env["AVIWEB_PASSWORD"] = prevPass;
  });
});
