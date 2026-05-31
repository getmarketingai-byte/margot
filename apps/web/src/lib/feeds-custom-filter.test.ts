import type { GeneratedEvent } from "@margot/schema";
import { describe, expect, it } from "vitest";
import { filterEventsForCustomRules, eventIsGenericTravel } from "./feeds-custom-filter";

function ev(
  base: Omit<GeneratedEvent, "busy" | "tags"> & { tags?: string[]; busy?: boolean }
): GeneratedEvent {
  return {
    busy: base.busy ?? true,
    tags: base.tags ?? [],
    uid: base.uid,
    kind: base.kind,
    title: base.title,
    startMs: base.startMs,
    endMs: base.endMs,
    ...(base.description !== undefined ? { description: base.description } : {}),
    ...(base.location !== undefined ? { location: base.location } : {})
  };
}

describe("filterEventsForCustomRules", () => {
  const events: GeneratedEvent[] = [
    ev({
      uid: "u1",
      kind: "sleep",
      title: "Sleep",
      startMs: 0,
      endMs: 1,
      tags: ["system", "sleep"]
    }),
    ev({
      uid: "u2",
      kind: "weekly-goal",
      title: "Gym block",
      startMs: 0,
      endMs: 1,
      tags: ["goal:g1", "special:gym"]
    }),
    ev({
      uid: "u3",
      kind: "travel",
      title: "[Drive]",
      startMs: 0,
      endMs: 1,
      tags: ["system", "travel", "gym-pad", "drive-pre"]
    }),
    ev({
      uid: "u4",
      kind: "travel",
      title: "[Drive]",
      startMs: 0,
      endMs: 1,
      tags: ["system", "travel"]
    }),
    ev({
      uid: "u5",
      kind: "timemap",
      title: "[Outside]",
      startMs: 0,
      endMs: 1,
      tags: ["weather", "outside"]
    })
  ];

  it("returns only sleeping when sleep toggle is enabled", () => {
    const out = filterEventsForCustomRules(events, {
      version: 1,
      include: { sleep: true }
    });
    expect(out.map((e) => e.uid)).toEqual(["u1"]);
  });

  it("combines buckets with union semantics", () => {
    const out = filterEventsForCustomRules(events, {
      version: 1,
      include: { gymGoals: true, genericTravel: true }
    });
    expect(new Set(out.map((e) => e.uid))).toEqual(new Set(["u2", "u4"]));
  });

  it("targets a single goal tag", () => {
    const out = filterEventsForCustomRules(events, {
      version: 1,
      include: { goalIds: ["g1"] }
    });
    expect(out.map((e) => e.uid)).toEqual(["u2"]);
  });

  it("targets a consistency segment by segment-prefixed goal id", () => {
    const segEvents: GeneratedEvent[] = [
      ev({
        uid: "seg1",
        kind: "consistency-segment",
        title: "Morning block",
        startMs: 0,
        endMs: 1,
        tags: ["goal:segment:seg-a", "neutral"]
      })
    ];
    const out = filterEventsForCustomRules(segEvents, {
      version: 1,
      include: { goalIds: ["segment:seg-a"] }
    });
    expect(out.map((e) => e.uid)).toEqual(["seg1"]);
  });

  it("matches weather overlay", () => {
    const out = filterEventsForCustomRules(events, {
      version: 1,
      include: { weatherTimemap: true }
    });
    expect(out.map((e) => e.uid)).toEqual(["u5"]);
  });
});

describe("eventIsGenericTravel", () => {
  it("excludes gym-pad travel", () => {
    expect(
      eventIsGenericTravel(
        ev({
          uid: "t",
          kind: "travel",
          title: "x",
          startMs: 0,
          endMs: 1,
          tags: ["gym-pad"]
        })
      )
    ).toBe(false);
  });

  it("includes plain travel blocks", () => {
    expect(
      eventIsGenericTravel(
        ev({
          uid: "t",
          kind: "travel",
          title: "x",
          startMs: 0,
          endMs: 1,
          tags: ["system", "travel"]
        })
      )
    ).toBe(true);
  });

  it("excludes drive-arrival-buffer travel", () => {
    expect(
      eventIsGenericTravel(
        ev({
          uid: "t",
          kind: "travel",
          title: "[Drive] (arrive by) Meeting",
          startMs: 0,
          endMs: 1,
          tags: ["system", "travel", "drive-arrival-buffer"]
        })
      )
    ).toBe(false);
  });
});
