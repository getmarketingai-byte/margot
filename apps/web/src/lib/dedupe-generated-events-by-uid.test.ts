import type { GeneratedEvent } from "@calendar-automations/schema";
import { describe, expect, it } from "vitest";
import { dedupeGeneratedEventsByUid } from "./dedupe-generated-events-by-uid";

function ev(uid: string, startMs: number): GeneratedEvent {
  return {
    uid,
    kind: "travel",
    title: "[Drive] → X",
    startMs,
    endMs: startMs + 60_000,
    busy: true,
    tags: []
  };
}

describe("dedupeGeneratedEventsByUid", () => {
  it("keeps first of duplicate uids", () => {
    const a = ev("same-uid", 100);
    const b = { ...a, title: "second copy" };
    const out = dedupeGeneratedEventsByUid([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("[Drive] → X");
  });

  it("preserves distinct uids", () => {
    const out = dedupeGeneratedEventsByUid([ev("u1", 1), ev("u2", 2)]);
    expect(out.map((e) => e.uid)).toEqual(["u1", "u2"]);
  });
});
