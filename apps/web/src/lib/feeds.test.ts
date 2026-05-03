import type { GeneratedEvent } from "@calendar-automations/schema";
import { describe, expect, it } from "vitest";
import { filterEventsForFeed } from "./feeds";

describe("filterEventsForFeed", () => {
  it("strips drive-arrival-buffer rows from the all feed (e.g. stale snapshots)", () => {
    const events: GeneratedEvent[] = [
      {
        uid: "pre",
        kind: "travel",
        title: "Drive",
        startMs: 0,
        endMs: 1,
        busy: true,
        tags: ["system", "travel", "drive-pre"]
      },
      {
        uid: "buf",
        kind: "travel",
        title: "[Drive] (arrive by) X",
        startMs: 1,
        endMs: 2,
        busy: true,
        tags: ["system", "travel", "drive-arrival-buffer"]
      }
    ];
    const out = filterEventsForFeed(events, "all");
    expect(out.map((e) => e.uid)).toEqual(["pre"]);
  });
});
