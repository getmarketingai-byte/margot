import { describe, expect, it } from "vitest";
import { mergeIntervals, freeGaps, collectBusyIntervals } from "../src/intervals";
import type { BusyEvent } from "../src/types";

const h = (h: number) => h * 60 * 60 * 1000;

describe("mergeIntervals", () => {
  it("merges overlapping intervals", () => {
    const merged = mergeIntervals([
      { startMs: h(8), endMs: h(10) },
      { startMs: h(9), endMs: h(11) },
      { startMs: h(13), endMs: h(14) }
    ]);
    expect(merged).toEqual([
      { startMs: h(8), endMs: h(11) },
      { startMs: h(13), endMs: h(14) }
    ]);
  });

  it("returns empty for empty input", () => {
    expect(mergeIntervals([])).toEqual([]);
  });
});

describe("freeGaps", () => {
  it("returns the inverse of busy within a window", () => {
    const gaps = freeGaps(h(8), h(20), [
      { startMs: h(9), endMs: h(10) },
      { startMs: h(13), endMs: h(15) }
    ]);
    expect(gaps).toEqual([
      { startMs: h(8), endMs: h(9) },
      { startMs: h(10), endMs: h(13) },
      { startMs: h(15), endMs: h(20) }
    ]);
  });
});

describe("collectBusyIntervals", () => {
  const window = { start: h(0), end: h(24) };

  it("excludes free events and multi-day events", () => {
    const events: BusyEvent[] = [
      { sourceId: "a", title: "Meeting", startMs: h(9), endMs: h(10), busy: true, source: "google" },
      { sourceId: "b", title: "OOO", startMs: h(0), endMs: h(48), busy: true, source: "google" },
      { sourceId: "c", title: "Tentative", startMs: h(11), endMs: h(12), busy: false, source: "google" }
    ];
    const out = collectBusyIntervals(events, window.start, window.end);
    expect(out).toEqual([{ startMs: h(9), endMs: h(10) }]);
  });
});
