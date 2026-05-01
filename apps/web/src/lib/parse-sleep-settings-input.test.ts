import { describe, expect, it } from "vitest";
import {
  formatIdealWakeForInput,
  formatSleepDurationForInput,
  parseIdealWakeInput,
  parseSleepDurationInput,
  tryParseIdealWake,
  tryParseSleepDurationHours
} from "./parse-sleep-settings-input";

describe("tryParseIdealWake", () => {
  it("parses 12-hour with minutes", () => {
    expect(tryParseIdealWake("6:30am")).toEqual({ hour: 6, minute: 30 });
    expect(tryParseIdealWake("6:30 AM")).toEqual({ hour: 6, minute: 30 });
    expect(tryParseIdealWake("6:30pm")).toEqual({ hour: 18, minute: 30 });
  });

  it("parses 12-hour whole hours", () => {
    expect(tryParseIdealWake("12am")).toEqual({ hour: 0, minute: 0 });
    expect(tryParseIdealWake("12pm")).toEqual({ hour: 12, minute: 0 });
    expect(tryParseIdealWake("1pm")).toEqual({ hour: 13, minute: 0 });
  });

  it("parses 24-hour with colon", () => {
    expect(tryParseIdealWake("06:30")).toEqual({ hour: 6, minute: 30 });
    expect(tryParseIdealWake("18:45")).toEqual({ hour: 18, minute: 45 });
  });

  it("parses plain hour as 24-hour", () => {
    expect(tryParseIdealWake("6")).toEqual({ hour: 6, minute: 0 });
    expect(tryParseIdealWake("0")).toEqual({ hour: 0, minute: 0 });
  });

  it("returns null for invalid", () => {
    expect(tryParseIdealWake("")).toBeNull();
    expect(tryParseIdealWake("25:00")).toBeNull();
    expect(tryParseIdealWake("6:99")).toBeNull();
    expect(tryParseIdealWake("13am")).toBeNull();
  });
});

describe("parseIdealWakeInput fallback", () => {
  it("uses fallback when parse fails", () => {
    expect(parseIdealWakeInput("nope", { hour: 9, minute: 15 })).toEqual({ hour: 9, minute: 15 });
  });
});

describe("formatIdealWakeForInput", () => {
  it("round-trips common values", () => {
    const samples = [
      { hour: 6, minute: 30 },
      { hour: 0, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 23, minute: 59 }
    ];
    for (const w of samples) {
      const s = formatIdealWakeForInput(w.hour, w.minute);
      expect(tryParseIdealWake(s)).toEqual(parseIdealWakeInput(s, w));
    }
  });
});

describe("tryParseSleepDurationHours", () => {
  it("parses H:MM as hours and minutes", () => {
    expect(tryParseSleepDurationHours("7:30")).toBeCloseTo(7.5, 5);
    expect(tryParseSleepDurationHours("8:00")).toBe(8);
  });

  it("parses decimal hours", () => {
    expect(tryParseSleepDurationHours("7.5")).toBe(7.5);
    expect(tryParseSleepDurationHours("8")).toBe(8);
    expect(tryParseSleepDurationHours("7,25")).toBe(7.25);
  });

  it("rejects a.m./p.m.", () => {
    expect(tryParseSleepDurationHours("6:30am")).toBeNull();
  });
});

describe("parseSleepDurationInput", () => {
  it("falls back on bad input", () => {
    expect(parseSleepDurationInput("x", 8)).toBe(8);
  });
});

describe("formatSleepDurationForInput", () => {
  it("uses colon when there are minutes", () => {
    expect(formatSleepDurationForInput(7.5)).toBe("7:30");
    expect(formatSleepDurationForInput(8)).toBe("8");
  });
});
