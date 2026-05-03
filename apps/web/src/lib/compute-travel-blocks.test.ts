import type { BusyEvent } from "@calendar-automations/planner";
import { gymSettingsSchema, travelSettingsSchema } from "@calendar-automations/schema";
import { describe, expect, it } from "vitest";
import { computeTravelBlocks } from "./week-blocks";
import type { LegResolver } from "./routing";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** Resolver that never calls a provider — all legs use fallbacks. */
function noopResolver(): LegResolver {
  return {
    async resolveMany() {
      return new Map();
    },
    takeCacheUpdates: () => null
  };
}

describe("computeTravelBlocks", () => {
  it("ignores free/transparent busy rows when building the physical chain", async () => {
    const travel = travelSettingsSchema.parse({
      homeAddress: "1 Home Rd",
      routingProvider: "disabled",
      fallbackDurationMinutes: 60,
      arriveMinutesBefore: 15,
      minHomeMinutes: 30
    });
    const gym = gymSettingsSchema.parse({});

    const t0 = Date.UTC(2026, 4, 6, 0, 0, 0, 0);
    const venue = "Beauty Park Frankston";

    const freePlaceholder: BusyEvent = {
      sourceId: "cal:free-setup",
      title: "Site prep (free)",
      startMs: t0 + 7 * HOUR_MS,
      endMs: t0 + 7 * HOUR_MS + 30 * MINUTE_MS,
      busy: false,
      location: venue,
      source: "google"
    };

    const technician: BusyEvent = {
      sourceId: "cal:tech-show",
      title: "Technician - Lighting: Neon Fields 2026",
      startMs: t0 + 8 * HOUR_MS,
      endMs: t0 + 20 * HOUR_MS,
      busy: true,
      location: venue,
      source: "google"
    };

    const blocks = await computeTravelBlocks(
      [freePlaceholder, technician],
      travel,
      gym,
      noopResolver()
    );

    const outbound = blocks.filter((b) => b.variant === "drive-pre");
    const direct = blocks.filter((b) => b.variant === "drive-direct");

    expect(outbound.some((b) => b.title.includes("Technician"))).toBe(true);
    expect(direct).toHaveLength(0);
  });
});
