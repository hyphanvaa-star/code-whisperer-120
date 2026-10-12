import { describe, expect, it } from "vitest";
import { MIN_LEN, isPredictable, passwordChecks } from "@/lib/password-rules";

// Every sample here was run against the live backend: REJECT means the
// server refused it with weak_password, ACCEPT means it stored it.
const REJECTED = ["abc123", "12345678", "password", "Flight2024", "Abc@1234", "abcd@efgh", "abc12345678", "aaaa1111!", "supabase123"];
const ACCEPTED = ["Xk9#mQ2$Lv7!", "Sohee#Dispatch2026", "Mekong7#River", "Hanoi!Office99", "Dong@Nai8821"];

describe("password-rules", () => {
  it("catches every password the backend rejected", () => {
    for (const p of REJECTED) {
      expect(passwordChecks(p, "hyphan").every((c) => c.ok), p).toBe(false);
    }
  });
  it("passes every password the backend accepted", () => {
    for (const p of ACCEPTED) {
      expect(passwordChecks(p, "hyphan").every((c) => c.ok), p).toBe(true);
    }
  });
  it("flags sequences, repeats and the Capital@1234 shape", () => {
    expect(isPredictable("abcd1234!")).toBe(true);
    expect(isPredictable("aaaa1111!")).toBe(true);
    expect(isPredictable("Abc@1234")).toBe(true);
    expect(isPredictable("12345678")).toBe(true);
    expect(isPredictable("Hanoi!Office99")).toBe(false);
  });
  it("requires the stated minimum length", () => {
    expect(MIN_LEN).toBe(8);
    expect(passwordChecks("aB3!xk9").some((c) => !c.ok)).toBe(true);
  });
  it("rejects a password containing the login name", () => {
    expect(passwordChecks("Hanoi!Office99", "hanoi").some((c) => !c.ok)).toBe(true);
  });
});
