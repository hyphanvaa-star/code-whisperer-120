import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const fbJson = vi.fn();
vi.mock("@/lib/flitebrief.server", () => ({ fbJson: (...a: unknown[]) => fbJson(...a) }));

const now = new Date("2026-11-07T02:47:00Z");
const vjc84 = { id: 22504713, callsign: "VJC84", std: "2026-11-07T10:00:00Z" };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); fbJson.mockReset(); vi.resetModules(); });
afterEach(() => vi.useRealTimers());

describe("NOTAM flight lookup shared by tracking and filtering", () => {
  it("never asks FliteBrief for 14 days; uses one small operational catalogue", async () => {
    fbJson.mockResolvedValue([vjc84]);
    const { findOperationalFlightById, OPS_LOOKUP_DAYS } = await import("../../core/gantts.server");
    expect(OPS_LOOKUP_DAYS).toBe(3);
    expect((await findOperationalFlightById(22504713))?.id).toBe(22504713);
    expect(fbJson.mock.calls.map((c) => c[0])).toEqual(["/webapi/gantts?days=3"]);
  });

  it("filter step finds the same flight the tracking step found (one shared cache)", async () => {
    fbJson.mockResolvedValue([vjc84]);
    const { findOperationalFlightById } = await import("../../core/gantts.server");
    await findOperationalFlightById(22504713); // tracking
    expect((await findOperationalFlightById(22504713))?.id).toBe(22504713); // filtering
    expect(fbJson).toHaveBeenCalledTimes(1);
  });

  it("a stale cache missing the flight forces one fresh read instead of reporting not found", async () => {
    fbJson.mockResolvedValueOnce([]).mockResolvedValueOnce([vjc84]);
    const { findOperationalFlightById, loadFlights } = await import("../../core/gantts.server");
    await loadFlights(3);
    expect((await findOperationalFlightById(22504713))?.id).toBe(22504713);
    expect(fbJson).toHaveBeenCalledTimes(2);
  });

  it("still refuses a flight outside −6/+24", async () => {
    fbJson.mockResolvedValue([{ ...vjc84, std: "2026-11-06T18:00:00Z" }]);
    const { findOperationalFlightById } = await import("../../core/gantts.server");
    expect(await findOperationalFlightById(22504713)).toBeNull();
  });
});
