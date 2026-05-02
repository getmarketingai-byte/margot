import { describe, expect, it } from "vitest";
import {
  emptyIcsFeedRules,
  icsFeedRulesHasSelection,
  parseIcsFeedRules
} from "../src/ics-feed-rules";

describe("icsFeedRulesHasSelection", () => {
  it("is false when no toggles or ids", () => {
    expect(icsFeedRulesHasSelection(emptyIcsFeedRules().include)).toBe(false);
  });

  it("is true for a bucket toggle", () => {
    expect(icsFeedRulesHasSelection({ sleep: true })).toBe(true);
  });

  it("is true when goal IDs are listed", () => {
    expect(icsFeedRulesHasSelection({ goalIds: ["goal-1"] })).toBe(true);
  });
});

describe("parseIcsFeedRules", () => {
  it("accepts sleep flag", () => {
    const r = parseIcsFeedRules({ version: 1, include: { sleep: true } });
    expect(r.include.sleep).toBe(true);
  });
});
