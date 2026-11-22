import { describe, expect, it } from "vitest";
import { adminOnlyError, settingsTarget } from "../../store.server";

const UID = "23cad4fb-ad4f-4d96-929b-10bd83d72633";

describe("settingsTarget", () => {
  it("ALT Route saves to the admin's own copy, not the team copy", () => {
    expect(settingsTarget("fpl.alt_route", true, UID)).toBe(`fpl.alt_route@u:${UID}`);
  });
  it("ALT Route saves to a dispatcher's own copy", () => {
    expect(settingsTarget("fpl.alt_route", false, UID)).toBe(`fpl.alt_route@u:${UID}`);
  });
  it("ERA is a personal table for admin and dispatcher alike", () => {
    expect(settingsTarget("fpl.era", true, UID)).toBe(`fpl.era@u:${UID}`);
    expect(settingsTarget("fpl.era", false, UID)).toBe(`fpl.era@u:${UID}`);
  });
  it("AFTN Address book is stored per account", () => {
    expect(settingsTarget("aftn.book", true, UID)).toBe(`aftn.book@u:${UID}`);
    expect(settingsTarget("aftn.book", false, UID)).toBe(`aftn.book@u:${UID}`);
  });
  it("Cost Index has a single team copy (no private dispatcher copy)", () => {
    expect(settingsTarget("fpl.cost_index", true, UID)).toBe("fpl.cost_index");
    expect(settingsTarget("fpl.cost_index", false, UID)).toBe("fpl.cost_index");
  });
});

describe("adminOnlyError", () => {
  it.each(["fpl.cost_index", "fpl.taxi_fuel", "fpl.route_suffix", "fpl.pcr_limits", "fpl.atc_fix"])(
    "dispatcher cannot save %s, admin can",
    (key) => {
      expect(adminOnlyError(key, false)).toMatch(/Chỉ Admin/);
      expect(adminOnlyError(key, true)).toBeNull();
    },
  );
  it.each(["fpl.alt_route", "fpl.era", "aftn.book"])("dispatcher can save own %s", (key) => {
    expect(adminOnlyError(key, false)).toBeNull();
  });
});
