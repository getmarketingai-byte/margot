import type { BusyEvent } from "@margot/planner";
import { gymSettingsSchema, travelSettingsSchema } from "@margot/schema";
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

  it("applies arriveMinutesBefore to drive-pre duration for normal events", async () => {
    const travel = travelSettingsSchema.parse({
      homeAddress: "1 Home Rd",
      routingProvider: "disabled",
      fallbackDurationMinutes: 60,
      arriveMinutesBefore: 15,
      minHomeMinutes: 30
    });
    const gym = gymSettingsSchema.parse({
      enabled: true,
      title: "Gym",
      blockLabel: "Physical activity",
      locationSubstring: "Snap Fitness",
      driveMinutes: 10
    });

    const t0 = Date.UTC(2026, 4, 6, 0, 0, 0, 0);
    const gymVenue = "Snap Fitness 24/7, Example St";

    const workMeeting: BusyEvent = {
      sourceId: "cal:work",
      title: "Client review",
      startMs: t0 + 9 * HOUR_MS,
      endMs: t0 + 10 * HOUR_MS,
      busy: true,
      location: "100 Collins St, Melbourne",
      source: "google"
    };

    const physicalAtGym: BusyEvent = {
      sourceId: "cal:gym-block",
      title: "Physical activity",
      startMs: t0 + 12 * HOUR_MS,
      endMs: t0 + 13 * HOUR_MS,
      busy: true,
      location: gymVenue,
      source: "google"
    };

    const blocks = await computeTravelBlocks(
      [workMeeting, physicalAtGym],
      travel,
      gym,
      noopResolver()
    );

    const workPre = blocks.find(
      (b) => b.variant === "drive-pre" && b.title.includes("Client review")
    );
    const workArrival = blocks.find(
      (b) => b.variant === "drive-arrival-buffer" && b.title.includes("Client review")
    );
    const gymPre = blocks.find(
      (b) => b.variant === "drive-pre" && b.title.includes("Physical activity")
    );

    expect(workPre).toBeDefined();
    expect(workPre!.endMs - workPre!.startMs).toBe(60 * MINUTE_MS);
    expect(workPre!.endMs).toBe(workMeeting.startMs - 15 * MINUTE_MS);

    expect(workArrival).toBeDefined();
    expect(workArrival!.endMs - workArrival!.startMs).toBe(15 * MINUTE_MS);
    expect(workArrival!.startMs).toBe(workPre!.endMs);
    expect(workArrival!.endMs).toBe(workMeeting.startMs);

    expect(gymPre).toBeDefined();
    expect(gymPre!.endMs - gymPre!.startMs).toBe(10 * MINUTE_MS);
    expect(
      blocks.some((b) => b.variant === "drive-arrival-buffer" && b.title.includes("Physical activity"))
    ).toBe(false);
  });
});
