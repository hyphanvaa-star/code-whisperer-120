import { describe, expect, it } from "vitest";
import { parseEtpAltTimes } from "../notam_check_tune";
import { assessNotam, DEFAULT_ASSESS_CFG, type AssessFlight } from "../notam_assess";

const OFP = `
ETP VVTS/VVDN 0180/0169 P019/M006 002199 015719  013520 00.29/00.25
     N13138  E108306
ETP VVDN/VHHH 0267/0248 P019/M009 002948 013014  010066 01.23/00.37
ETP VHHH/RCTP 0233/0238 M005/P001 002731 010412  007681 02.17/00.34
ETP RCTP/RKPC 0302/0283 P003/M027 003347 007146  003799 03.27/00.44
ETP RKPC/RKPK 0083/0076 P015/M014 001201 005130  003929 04.15/00.11
ETP VVTS/VVDN 0180/0169 P019/M006 002199 015719  013520 00.29/00.25
`;

describe("ETP en-route alternate timing (VJC868 VVTS-RKPK)", () => {
  it("arrival = TIME TO ETP + TIME TO ALT", () => {
    const t = parseEtpAltTimes(OFP);
    expect(t.VVDN).toEqual([54, 120]); // 17:59Z .. 19:05Z after ETD 17:05Z
    expect(t.VHHH).toEqual([120, 171]); // 19:05Z .. 19:56Z
    expect(t.RCTP).toEqual([171, 251]);
    expect(t.RKPC).toEqual([251, 266]);
  });

  it("RALT window is arrival ±60 min, not whole flight", () => {
    const etd = new Date("2026-11-09T17:05:00Z");
    const f: AssessFlight = {
      etd, eta: new Date("2026-11-09T21:36:00Z"),
      roles: { VVTS: "DEP", RKPK: "ARR", VVDN: "RALT" },
      ralt_arr: { VVDN: [new Date("2026-11-09T17:59:00Z"), new Date("2026-11-09T19:05:00Z")] },
      firs: {}, points: [], tokens: new Set(), sid: null, star: null, acType: "A321",
    };
    const n = { start: "2026-11-09 21:30", end: "2026-11-09 23:00", text: "AD CLSD", e_field: "AD CLSD", qfir: "VVHM", lower: "0", upper: "999" };
    // NOTAM starts 21:30Z — after 20:05Z (VVDN arrival 19:05Z + 60'), so not on-time impact.
    expect(assessNotam(n, "VVDN", "AD", f, { ...DEFAULT_ASSESS_CFG, max_delay_minutes: 0 }).level).toBe("NO IMPACT");
    const hit = { ...n, start: "2026-11-09 19:30", end: "2026-11-09 23:00" };
    expect(assessNotam(hit, "VVDN", "AD", f, DEFAULT_ASSESS_CFG).level).toBe("CRITICAL");
  });
});
