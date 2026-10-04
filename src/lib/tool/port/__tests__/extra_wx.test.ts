import { describe, it, expect } from "vitest";
import * as extraWx from "../extra_wx";
import * as taf from "../taf";

describe("extra_wx vis bands", () => {
  it("bands", () => {
    expect(extraWx.visBand(5000)).toBe("A");
    expect(extraWx.visBand(9999)).toBe("A");
    expect(extraWx.visBand(3500)).toBe("B");
    expect(extraWx.visBand(4999)).toBe("B");
    expect(extraWx.visBand(1500)).toBe("C");
    expect(extraWx.visBand(3499)).toBe("C");
    expect(extraWx.visBand(1499)).toBe("D");
    expect(extraWx.visBand(0)).toBe("D");
  });
});

describe("needOfText", () => {
  it("tsra vis 2000 is band C 60", () => {
    const got = extraWx.needOfText("24012KT 2000 TSRA BKN020");
    expect(got.band).toBe("C");
    expect(got.minutes).toBe(60);
    expect(got.wx).toBe(60);
  });

  it("va is zero hold", () => {
    const got = extraWx.needOfText("24008KT 2000 VA BKN012");
    expect(got.wx).toBe(0);
    expect(got.minutes).toBe(0);
  });

  it("ceiling and wind take max", () => {
    const got = extraWx.needOfText("36035KT 9999 BKN008");
    expect(got.wx).toBe(0);
    expect(got.ceil).toBe(15);
    expect(got.wind).toBe(30);
    expect(got.minutes).toBe(30);
  });

  it("cap 60", () => {
    const got = extraWx.needOfText("36045G55KT 0800 +TSRA OVC002");
    expect(got.minutes).toBe(60);
  });

  it("tempo chunk is full not point seven", () => {
    const got = extraWx.needOfTexts(["24008KT 9999 NSW SCT020", "24016KT 2000 TSRA SCT015 FEW017CB"]);
    expect(got.minutes).toBe(60);
  });

  it("light rain drops ten", () => {
    const got = extraWx.needOfText("24008KT 2000 -RA SCT012");
    expect(got.wx).toBe(35);
  });
});

function rec(groups: taf.TafGroup[], valid = "1200/1306") {
  return {
    icao: "VVTS", nil: false, valid,
    valid_from: "2026-08-12T00:00:00.000Z",
    valid_to: "2026-08-13T06:00:00.000Z",
    raw: "TAF VVTS",
    groups,
  };
}

describe("advice extra need", () => {
  it("tempo sample sets extra_need", () => {
    const when = new Date(Date.UTC(2026, 7, 12, 8, 0));
    const r = rec([
      { kind: "BASE", token: "", start: "2026-08-12T00:00:00.000Z", end: "2026-08-13T06:00:00.000Z", text: "24008KT 9999 SCT017" },
      { kind: "TEMPO", token: "", start: "2026-08-12T07:00:00.000Z", end: "2026-08-12T10:00:00.000Z", text: "24016G30KT 4000 TSRA SCT015 FEW017CB" },
    ]);
    const item = taf.advise("VVTS", when, { VVTS: r });
    expect(item.status).toBe("bad");
    expect(item.extra_need).toBe(45);
    expect(item.extra_why).toContain("TSRA");
  });

  it("ok path still has extra fields", () => {
    const when = new Date(Date.UTC(2026, 7, 12, 5, 42));
    const r = rec([
      { kind: "BASE", token: "", start: "2026-08-12T00:00:00.000Z", end: "2026-08-13T06:00:00.000Z", text: "24008KT 9999 NSW SCT017" },
    ]);
    const item = taf.advise("VVTS", when, { VVTS: r });
    expect(item.status).toBe("ok");
    expect(item.extra_need).toBe(0);
  });
});
