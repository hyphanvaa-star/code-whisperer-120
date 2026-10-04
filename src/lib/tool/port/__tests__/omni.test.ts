// Port of tests/test_omni_window.py — Omni EST: hôm nay + mai; chuyến hôm nay
// không ăn payload ngày mai.
import { describe, it, expect } from "vitest";
import * as omni from "../omni";
import { Flight } from "../../core/models";

function mkOmni(
  digits: string,
  day: { y: number; m: number; d: number },
  hhmm = "23:30",
  est = 1000.0,
  dep = "SGN",
  arr = "HAN",
): omni.OmniFlight {
  const [h, m] = hhmm.split(":").map(Number);
  return {
    flt: "VJ" + digits,
    digits,
    dep,
    arr,
    std_local: new Date(Date.UTC(day.y, day.m, day.d, h, m)),
    reg: "",
    ac_type: "",
    flight_type: "",
    est_payload: est,
    pax_weight: null,
    bag_weight: null,
    cargo_confirm: null,
    cargo_capacity: null,
    tare: null,
    cot_utc: null,
    est_time_utc: null,
  };
}

function mkFb(digits: string, stdUtc: Date, dep = "SGN", arr = "HAN"): Flight {
  return new Flight({ id: Number(digits), callsign: "VJC" + digits, dep_iata: dep, dest_iata: arr, std: stdUtc });
}

describe("omni.ts — default_span", () => {
  it("is today and tomorrow", () => {
    const [a, b] = omni.defaultSpan(new Date(Date.UTC(2026, 7, 16)));
    expect(a).toBe("2026-08-16");
    expect(b).toBe("2026-08-17");
  });
});

describe("omni.ts — fetchOmni window", () => {
  it("default asks today and tomorrow only", async () => {
    const asked: string[] = [];
    const rows = await omni.fetchOmni(
      { username: "u", password: "p" },
      {
        fromDate: "2026-08-16",
        toDate: "2026-08-17",
        session: { token: "t" },
        fetchDay: async (_s, day) => {
          asked.push(day);
          return [mkOmni("1", parseDayLocal(day))];
        },
      },
    );
    expect(asked).toEqual(["2026-08-16", "2026-08-17"]);
    expect(rows.length).toBe(2);
  });

  function parseDayLocal(s: string) {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)!;
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  }

  async function fetchBoth(early: omni.OmniFlight, late: omni.OmniFlight) {
    return omni.fetchOmni(
      { username: "u", password: "p" },
      {
        fromDate: "2026-08-16",
        toDate: "2026-08-17",
        session: { token: "t" },
        fetchDay: async (_s, day) => (day === "2026-08-16" ? [early] : [late]),
      },
    );
  }

  it("before 17:00Z does not take next day page (08:00 ICT = 01:00Z)", async () => {
    const day = { y: 2026, m: 7, d: 16 };
    const rows = await fetchBoth(mkOmni("915", day, "08:00", 1111.0), mkOmni("915", day, "08:00", 2222.0));
    expect(rows[0]!.est_payload).toBe(1111.0);
  });

  it("exactly 17:00Z does not overwrite (00:00 ICT = 17:00Z)", async () => {
    const day = { y: 2026, m: 7, d: 17 };
    const rows = await fetchBoth(mkOmni("915", day, "00:00", 1111.0), mkOmni("915", day, "00:00", 2222.0));
    expect(rows[0]!.est_payload).toBe(1111.0);
  });

  it("after 17:00Z takes next day page (00:30 ICT = 17:30Z)", async () => {
    const day = { y: 2026, m: 7, d: 17 };
    const rows = await fetchBoth(mkOmni("915", day, "00:30", 1111.0), mkOmni("915", day, "00:30", 2222.0));
    expect(rows[0]!.est_payload).toBe(2222.0);
  });
});

describe("omni.ts — fetchOmni export fallback", () => {
  it("posts one flight date via /api/v1/cargo/flights/export name", () => {
    expect(omni.FLIGHTS_EXPORT).toBe("/api/v1/cargo/flights/export");
  });
});

describe("omni.ts — match()", () => {
  it("same day beats a closer other day", () => {
    const fb = mkFb("915", new Date(Date.UTC(2026, 7, 16, 16, 0))); // 23:00 ICT 16/08
    const rows = [
      mkOmni("915", { y: 2026, m: 7, d: 16 }, "23:00", 8000.0), // lệch 7h
      mkOmni("915", { y: 2026, m: 7, d: 17 }, "01:00", 15000.0), // lệch 9h
    ];
    const got = omni.match([fb], rows);
    expect(got.get(915)!.omni.est_payload).toBe(8000.0);
  });

  it("tomorrow flitebrief takes tomorrow omni", () => {
    const fb = mkFb("915", new Date(Date.UTC(2026, 7, 17, 16, 30)));
    const rows = [
      mkOmni("915", { y: 2026, m: 7, d: 16 }, "23:30", 8000.0),
      mkOmni("915", { y: 2026, m: 7, d: 17 }, "23:30", 15000.0),
    ];
    const got = omni.match([fb], rows);
    expect(got.get(915)!.omni.est_payload).toBe(15000.0);
  });

  it("after 17:00Z may use next local day (18:00Z = 01:00 ICT next day)", () => {
    const fb = mkFb("915", new Date(Date.UTC(2026, 7, 16, 18, 0)));
    const rows = [
      mkOmni("915", { y: 2026, m: 7, d: 16 }, "23:00", 8000.0),
      mkOmni("915", { y: 2026, m: 7, d: 17 }, "01:00", 15000.0),
    ];
    const got = omni.match([fb], rows);
    expect(got.get(915)!.omni.est_payload).toBe(15000.0);
  });

  it("MNL 03:00 LT is 19:00Z so today board takes next local day", () => {
    expect(omni.omniStdUtc(mkOmni("859", { y: 2026, m: 7, d: 17 }, "03:00", 0, "MNL", "SGN"))).toEqual(
      new Date(Date.UTC(2026, 7, 16, 19, 0)),
    );
    const fb = mkFb("859", new Date(Date.UTC(2026, 7, 16, 19, 0)), "MNL", "SGN");
    const rows = [
      mkOmni("859", { y: 2026, m: 7, d: 16 }, "03:00", 9840.0, "MNL", "SGN"),
      mkOmni("859", { y: 2026, m: 7, d: 17 }, "03:00", 11315.0, "MNL", "SGN"),
    ];
    const got = omni.match([fb], rows);
    expect(got.get(859)!.omni.est_payload).toBe(11315.0);
  });
});
