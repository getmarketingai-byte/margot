import { describe, expect, it } from "vitest";
import { displayBusyEventLabel } from "../src/busy-label";
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
