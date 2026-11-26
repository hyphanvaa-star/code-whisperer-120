import { afterEach, describe, expect, it, vi } from "vitest";
import script from "../../../../tool/database-tab.js?raw";

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("Airport search", () => {
  function open() {
    vi.useFakeTimers();
    document.body.innerHTML = '<div class="modes"><button id="mAftn"></button></div><div id="wrapAftn"></div>';
    Object.assign(window, { __airportCatalogue: [["VVTS", "VN", "07:00"], ["ZSTX", "CN", "08:00"], ["ZBTJ", "CN", "08:00"]] });
    window.eval(script);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    document.querySelector<HTMLButtonElement>('[data-btn="dbxAirports"]')?.click();
    const input = document.querySelector<HTMLInputElement>("#dbxAptQ");
    if (!input) throw new Error("Airport search unavailable");
    return input;
  }
  it("finds ZSTX and ZBTJ even when Vietnam was selected", () => {
    const input = open();
    for (const code of ["ZSTX", "ZBTJ"]) {
      input.value = code; input.dispatchEvent(new Event("input"));
      expect([...document.querySelectorAll(".dbx-apt-icao")].map(el => el.textContent)).toEqual([code]);
    }
  });
  it("clear restores selected country's airports", () => {
    const input = open();
    input.value = "ZSTX"; input.dispatchEvent(new Event("input"));
    input.value = ""; input.dispatchEvent(new Event("search"));
    expect([...document.querySelectorAll(".dbx-apt-icao")].map(el => el.textContent)).toEqual(["VVTS"]);
  });
  it("unaccented country search finds both Chinese airports", () => {
    const input = open();
    input.value = "trung quoc"; input.dispatchEvent(new Event("input"));
    expect([...document.querySelectorAll(".dbx-apt-icao")].map(el => el.textContent)).toEqual(["ZSTX", "ZBTJ"]);
  });
});