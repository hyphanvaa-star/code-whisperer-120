import { describe, expect, it } from "vitest";
import { settingsTarget } from "../../store.server";

const UID = "23cad4fb-ad4f-4d96-929b-10bd83d72633";

describe("settingsTarget", () => {
  it("ALT Route saves to the admin's own copy, not the team copy", () => {
    expect(settingsTarget("fpl.alt_route", true, UID)).toBe(`fpl.alt_route@u:${UID}`);
  });
  it("ALT Route saves to a dispatcher's own copy", () => {
    expect(settingsTarget("fpl.alt_route", false, UID)).toBe(`fpl.alt_route@u:${UID}`);
  });
  it("other KHB tables keep admin = team copy", () => {
    expect(settingsTarget("fpl.cost_index", true, UID)).toBe("fpl.cost_index");
    expect(settingsTarget("fpl.cost_index", false, UID)).toBe(`fpl.cost_index@u:${UID}`);
  });
});
