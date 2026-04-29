import { describe, expect, it } from "vitest";
import { catchUpFloorsFromRecommendations } from "../src/catch-up-floors";

describe("catchUpFloorsFromRecommendations", () => {
  it("maps only positive catchUpRecommendation values", () => {
    expect(
      catchUpFloorsFromRecommendations([
        { goalId: "a", catchUpRecommendation: 30 },
        { goalId: "b", catchUpRecommendation: 0 },
        { goalId: "c", catchUpRecommendation: -5 }
      ])
    ).toEqual({ a: 30 });
  });

  it("returns empty object when no positive recommendations", () => {
    expect(
      catchUpFloorsFromRecommendations([
        { goalId: "a", catchUpRecommendation: 0 },
        { goalId: "b", catchUpRecommendation: 0 }
      ])
    ).toEqual({});
  });
});
