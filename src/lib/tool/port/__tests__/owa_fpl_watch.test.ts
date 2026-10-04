import { describe, expect, it } from "vitest";
import * as watch from "../owa_fpl_watch";

describe("owa_fpl_watch parsing", () => {
  it("ver and day from subject", () => {
    expect(watch.parseFplVer("FLIGHT PLAN ON 20 AUG – VER 08")).toBe(8);
    expect(watch.parseFplDay("FPL 20 AUG - VER 08.xlsx", { today: "2026-08-20" })).toBe("2026-08-20");
  });

  it("glued date with year suffix", () => {
    const subj = "//UPDATE// FLIGHT PLAN ON 21AUG26 - VER 09";
    expect(watch.parseFplVer(subj)).toBe(9);
    expect(watch.parseFplDay(subj, { today: "2026-08-21" })).toBe("2026-08-21");
  });

  it("update prefix without flight plan is still fpl", () => {
    const hint = watch.fplHintFromMessage(
      { Id: "m9", Subject: "//UPDATE// VER 09", ReceivedDateTime: "2026-08-21T02:19:00Z" },
      { today: "2026-08-21" },
    );
    expect(hint).not.toBeNull();
    expect(hint!.ver).toBe(9);
    expect(hint!.update).toBe(true);
    expect(watch.isUpdateFpl("UPDATE FLIGHT PLAN ON 01 SEP - VER 06")).toBe(true);
    expect(watch.isUpdateFpl("FLIGHT PLAN ON 01 SEP - VER 06")).toBe(false);
  });

  it("classify fpl/crew/png", () => {
    expect(watch.classifyAttachment("FLIGHT PLAN ON 20 AUG – VER 08", "FPL 20 AUG - VER 08.xlsx")).toBe("fpl");
    expect(watch.classifyAttachment("CREW LIST ON 20 AUG VER 04", "CREW LIST 20 AUG VER 04.xlsx")).toBe("crew");
    expect(watch.classifyAttachment("FLIGHT PLAN ON 20 AUG – VER 08", "image.png")).toBe("");
    expect(watch.classifyAttachment("//UPDATE// FLIGHT PLAN ON 21AUG26 - VER 09", "UPDATE VER 09.xlsx")).toBe("fpl");
    expect(watch.classifyAttachment("", "UPDATE VER 09.xlsx")).toBe("fpl");
  });

  it("want_attachment keeps fpl, skips crew/unrelated", () => {
    expect(watch.wantAttachment("FLIGHT PLAN ON 20 AUG – VER 08", "FPL 20 AUG - VER 08.xlsx")).toBe(true);
    expect(watch.wantAttachment("//UPDATE// FLIGHT PLAN ON 21AUG26 - VER 09", "UPDATE VER 09.xlsx")).toBe(true);
    expect(watch.wantAttachment("CREW LIST ON 20 AUG VER 04", "CREW LIST 20 AUG VER 04.xlsx")).toBe(false);
    expect(watch.wantAttachment("FLIGHT PLAN ON 20 AUG – VER 08", "image.png")).toBe(false);
    expect(watch.wantAttachment("Invoice March", "invoice.xlsx")).toBe(false);
  });

  it("ranking: only today is ranked even when other day has higher ver", () => {
    const TODAY = "2026-08-20";
    const hints: watch.FplHint[] = [
      { mid: "today12", subject: "FPL 20 AUG VER 12", when: null, day: TODAY, ver: 12, update: false },
      { mid: "today11", subject: "FPL 20 AUG VER 11", when: null, day: TODAY, ver: 11, update: false },
      { mid: "tomorrow99", subject: "FPL 21 AUG VER 99", when: null, day: "2026-08-21", ver: 99, update: false },
    ];
    expect(watch.pickRankedFpl(hints, { wantDay: TODAY }).map((h) => h.mid)).toEqual(["today12", "today11"]);
  });

  it("no today fpl does not fall back to another day", () => {
    const TODAY = "2026-08-20";
    const hints: watch.FplHint[] = [{ mid: "old", subject: "FPL 19 AUG VER 20", when: null, day: "2026-08-19", ver: 20, update: false }];
    expect(watch.pickRankedFpl(hints, { wantDay: TODAY })).toEqual([]);
    expect(watch.pickLatestFpl(hints, { wantDay: TODAY })).toBeNull();
  });

  it("adjacent prev is latest minus one, not whatever is second", () => {
    const TODAY = "2026-08-20";
    const mk = (mid: string, ver: number): watch.FplHint => ({ mid, subject: `FPL VER ${ver}`, when: null, day: TODAY, ver, update: false });
    const ranked = watch.pickRankedFpl([mk("m8", 8), mk("m7", 7), mk("m3", 3)], { wantDay: TODAY });
    const prev = watch.pickAdjacentPrev(ranked, 8);
    expect(prev?.ver).toBe(7);
    const onlyGap = watch.pickRankedFpl([mk("m8", 8), mk("m3", 3)], { wantDay: TODAY });
    expect(watch.pickAdjacentPrev(onlyGap, 8)?.ver).toBe(3);
  });

  it("update of same ver outranks plain mail", () => {
    const TODAY = "2026-08-20";
    const earlier = new Date("2026-08-20T12:07:00Z");
    const later = new Date("2026-08-20T12:30:00Z");
    const plainH: watch.FplHint = { mid: "plain", subject: "FLIGHT PLAN ON 20 AUG - VER 06", when: earlier, day: TODAY, ver: 6, update: false };
    const updH: watch.FplHint = { mid: "upd", subject: "UPDATE FLIGHT PLAN ON 20 AUG - VER 06", when: later, day: TODAY, ver: 6, update: true };
    const ranked = watch.pickRankedFpl([plainH, updH], { wantDay: TODAY });
    expect(ranked[0]!.mid).toBe("upd");
    expect(ranked[0]!.update).toBe(true);
    const plain = watch.pickPlainSameVer([plainH, updH], { wantDay: TODAY, ver: 6 });
    expect(plain?.mid).toBe("plain");
  });
});
