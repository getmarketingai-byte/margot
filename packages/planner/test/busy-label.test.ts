import { describe, expect, it } from "vitest";
import { displayBusyEventLabel, sleepConflictBusyLabel } from "../src/busy-label";
import type { BusyEvent } from "../src/types";

function ev(partial: Partial<BusyEvent> & Pick<BusyEvent, "startMs" | "endMs">): BusyEvent {
  return {
    sourceId: "x",
    title: "",
    busy: true,
    source: "google",
    ...partial
  };
}

describe("displayBusyEventLabel", () => {
  it("returns trimmed title when present", () => {
    expect(displayBusyEventLabel(ev({ startMs: 0, endMs: 1, title: "  Meet  " }))).toBe("Meet");
  });

  it("shows calendar name when title is empty", () => {
    expect(
      displayBusyEventLabel(
        ev({
          startMs: 0,
          endMs: 1,
          title: "",
          calendarDisplayName: "Work"
        })
      )
    ).toBe("(no title · Work)");
  });

  it("falls back to (no title) when both are missing", () => {
    expect(displayBusyEventLabel(ev({ startMs: 0, endMs: 1, title: "   " }))).toBe("(no title)");
  });
});

describe("sleepConflictBusyLabel", () => {
  it("suffixes Google calendar display name when title is present", () => {
    expect(
      sleepConflictBusyLabel(
        ev({
          startMs: 0,
          endMs: 1,
          title: "Technician",
          calendarDisplayName: "Work",
          source: "google"
        })
      )
    ).toBe("Technician · Work");
  });

  it("uses Planner travel for internal busy without calendarDisplayName", () => {
    expect(
      sleepConflictBusyLabel(
        ev({
          startMs: 0,
          endMs: 1,
          title: "[Drive] → Shift",
          source: "internal"
        })
      )
    ).toBe("[Drive] → Shift · Planner travel");
  });
});
