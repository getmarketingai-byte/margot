import { describe, expect, it } from "vitest";
import { renderIcs, buildStableUid } from "../src/ics";

describe("renderIcs", () => {
  it("renders a minimal VCALENDAR with one VEVENT", () => {
    const start = Date.UTC(2026, 3, 27, 9, 0, 0);
    const end = start + 60 * 60 * 1000;
    const ics = renderIcs(
      [
        {
          uid: "test-1",
          kind: "weekly-goal",
          title: "Deep coding",
          startMs: start,
          endMs: end,
          busy: true,
          tags: ["hyperfocus", "professional"]
        }
      ],
      { calendarName: "Plan", domain: "test.local" }
    );
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:test-1@test.local");
    expect(ics).toContain("SUMMARY:Deep coding");
    expect(ics).toContain("DTSTART:20260427T090000Z");
    expect(ics).toContain("CATEGORIES:hyperfocus,professional");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("escapes commas and semicolons in summaries", () => {
    const start = Date.UTC(2026, 3, 27, 9, 0, 0);
    const ics = renderIcs(
      [
        {
          uid: "x",
          kind: "weekly-goal",
          title: "Hello, world; goodbye",
          startMs: start,
          endMs: start + 60_000,
          busy: false,
          tags: []
        }
      ],
      { calendarName: "x", domain: "t" }
    );
    expect(ics).toContain("SUMMARY:Hello\\, world\\; goodbye");
    expect(ics).toContain("TRANSP:TRANSPARENT");
  });
});

describe("buildStableUid", () => {
  it("produces deterministic, alpha-numeric UIDs", () => {
    expect(buildStableUid(["user", "abc123", 1234567890])).toBe("user-abc123-1234567890");
    expect(buildStableUid(["a", "b!@#$", "c"])).toBe("a-b-c");
  });
});
