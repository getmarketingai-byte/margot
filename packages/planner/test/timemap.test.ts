import { describe, expect, it } from "vitest";
import { placeTimemapBands } from "../src/timemap";

const h = (h: number) => h * 60 * 60 * 1000;

const bands = [
  { id: "needle-mover", title: "[1-Needle-Mover]", targetHours: 4, minHours: 2 },
  { id: "execute", title: "[2-Execute]", targetHours: 4, minHours: 2 },
  { id: "ops", title: "[3-Ops/Future]", targetHours: 4, minHours: 2 },
  { id: "play", title: "[4-Play]", targetHours: 4, minHours: 2 }
];

describe("placeTimemapBands sequential", () => {
  it("anchors bands at the latest available time, in order 1..N", () => {
    // Free 9-21 (12 hours)
    const blocks = placeTimemapBands({
      bands,
      freeGaps: [{ startMs: h(9), endMs: h(21) }],
      minBlockMinutes: 30,
      cumulativeDeepWork: false
    });
    expect(blocks).toHaveLength(3); // 12 hours / 4 hours = 3 bands fit
    expect(blocks[0]!.bandId).toBe("execute");
    expect(blocks[0]!.startMs).toBe(h(9));
    expect(blocks[blocks.length - 1]!.bandId).toBe("play");
    expect(blocks[blocks.length - 1]!.endMs).toBe(h(21));
  });

  it("flags under-minimum when not enough time", () => {
    const blocks = placeTimemapBands({
      bands,
      freeGaps: [{ startMs: h(18), endMs: h(19) }],
      minBlockMinutes: 30,
      cumulativeDeepWork: false
    });
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.underMinimum).toBe(true);
  });
});

describe("placeTimemapBands cumulative", () => {
  it("layers deep-work bands and reserves a play tail", () => {
    const blocks = placeTimemapBands({
      bands,
      freeGaps: [{ startMs: h(9), endMs: h(21) }],
      minBlockMinutes: 30,
      cumulativeDeepWork: true
    });
    const play = blocks.filter((b) => b.bandId === "play");
    expect(play.length).toBeGreaterThan(0);
    const needle = blocks.find((b) => b.bandId === "needle-mover");
    expect(needle).toBeTruthy();
    // Needle-mover should start before execute and ops in cumulative mode.
    const execute = blocks.find((b) => b.bandId === "execute");
    if (execute) expect(needle!.startMs).toBeLessThanOrEqual(execute.startMs);
  });
});
