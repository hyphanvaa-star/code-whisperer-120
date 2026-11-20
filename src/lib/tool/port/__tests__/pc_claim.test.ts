import { describe, expect, it } from "vitest";
import { agentIdFromCookie, canClaim } from "../pc_claim";

const OFFICE = "14.238.99.122";
const HY = "17a2acd2-ff3e-45d2-90dd-bcd55ff38d4a";
const TRINH = "356e283c-158d-4b0e-9ea7-28b3e9d5c338";
const none = () => false;

describe("canClaim", () => {
  const ezfwFromHyMachine = { payload: { _ip: OFFICE, _uid: HY, _aid: "aaaaaaaaaaaaaaaa" } };

  it("job pinned to a machine only goes to that machine", () => {
    expect(canClaim(ezfwFromHyMachine, { ip: OFFICE, uid: HY, aid: "aaaaaaaaaaaaaaaa" }, none)).toBe(true);
    // same account, same office network, other PC → refused
    expect(canClaim(ezfwFromHyMachine, { ip: OFFICE, uid: HY, aid: "bbbbbbbbbbbbbbbb" }, none)).toBe(false);
    // older helper without machine id → refused
    expect(canClaim(ezfwFromHyMachine, { ip: OFFICE, uid: HY, aid: "" }, none)).toBe(false);
  });

  it("colleague's helper on the same office IP never takes another account's job", () => {
    const job = { payload: { _ip: OFFICE, _uid: HY } };
    expect(canClaim(job, { ip: OFFICE, uid: TRINH, aid: "" }, none)).toBe(false);
    expect(canClaim(job, { ip: OFFICE, uid: HY, aid: "" }, none)).toBe(true);
  });

  it("unpaired helper on the same IP takes an account job only while that account's helper is offline", () => {
    const job = { payload: { _ip: OFFICE, _uid: HY } };
    expect(canClaim(job, { ip: OFFICE, uid: "", aid: "" }, (u) => u === HY)).toBe(false);
    expect(canClaim(job, { ip: OFFICE, uid: "", aid: "" }, none)).toBe(true);
    expect(canClaim(job, { ip: "1.2.3.4", uid: "", aid: "" }, none)).toBe(false);
  });

  it("untagged jobs keep legacy network matching", () => {
    expect(canClaim({ payload: {} }, { ip: OFFICE, uid: "", aid: "" }, none)).toBe(true);
    expect(canClaim({ payload: { _ip: OFFICE } }, { ip: OFFICE, uid: HY, aid: "x" }, none)).toBe(true);
    expect(canClaim({ payload: { _ip: "1.2.3.4" } }, { ip: OFFICE, uid: HY, aid: "x" }, none)).toBe(false);
  });
});

describe("agentIdFromCookie", () => {
  it("reads only a well-formed machine id", () => {
    expect(agentIdFromCookie("a=1; pc_aid=0123456789abcdef; b=2")).toBe("0123456789abcdef");
    expect(agentIdFromCookie("pc_aid=<script>")).toBe("");
    expect(agentIdFromCookie(null)).toBe("");
  });
});
