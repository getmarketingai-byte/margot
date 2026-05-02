import { describe, expect, it } from "vitest";
import { effectiveScheduleHorizon, clipIntervalBlocksToHorizon, DAY_MS, WEEK_MS } from "./effective-schedule-horizon";
import { getBillingState } from "./subscription";

describe("effectiveScheduleHorizon", () => {
  const baseMonday = Date.UTC(2026, 4, 4, 0, 0, 0, 0); // Mon May 4 2026 00:00 UTC (example anchor)

  it("paid subscription uses stored weeks capped 1–8", () => {
    const billing = getBillingState({
      subscriptionStatus: "active",
      trialEndsAt: null,
      paymentGateBypass: false,
      now: baseMonday + 3 * DAY_MS
    });
    const h = effectiveScheduleHorizon({
      billing,
      storedScheduleHorizonWeeks: 3,
      nowMs: baseMonday + 3 * DAY_MS,
      baseWeekStartMs: baseMonday
    });
    expect(h.isoWeekCount).toBe(3);
    expect(h.horizonEndMs).toBe(baseMonday + 3 * WEEK_MS);
    expect(h.trialRollingClip).toBe(false);
    expect(h.cacheKeySegment).toBe("paid-w3");
  });

  it("trial uses rolling 7d horizon and at least one ISO week", () => {
    const billing = getBillingState({
      subscriptionStatus: "none",
      trialEndsAt: new Date(baseMonday + 14 * DAY_MS),
      paymentGateBypass: false,
      now: baseMonday + 3 * DAY_MS
    });
    expect(billing.mode).toBe("trial");
    const nowMs = baseMonday + 3 * DAY_MS;
    const h = effectiveScheduleHorizon({
      billing,
      storedScheduleHorizonWeeks: 8,
      nowMs,
      baseWeekStartMs: baseMonday
    });
    expect(h.horizonEndMs).toBe(nowMs + 7 * DAY_MS);
    expect(h.trialRollingClip).toBe(true);
    expect(h.isoWeekCount).toBeGreaterThanOrEqual(1);
    expect(h.isoWeekCount).toBeLessThanOrEqual(2);
  });

  it("clipIntervalBlocksToHorizon trims and drops", () => {
    const horizon = 1000;
    const blocks = [
      { startMs: 0, endMs: 500, x: 1 },
      { startMs: 800, endMs: 1500, x: 2 },
      { startMs: 1200, endMs: 2000, x: 3 }
    ];
    const clipped = clipIntervalBlocksToHorizon(blocks, horizon);
    expect(clipped).toEqual([
      { startMs: 0, endMs: 500, x: 1 },
      { startMs: 800, endMs: 1000, x: 2 }
    ]);
  });
});
