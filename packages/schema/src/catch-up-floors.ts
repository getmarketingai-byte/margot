/**
 * Maps goal rollups (or equivalent recommendation rows) to `catchUpFloors`
 * for `allocateWeek`. Only positive recommendations become floors.
 */

export function catchUpFloorsFromRecommendations(
  rollups: ReadonlyArray<{ goalId: string; catchUpRecommendation: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rollups) {
    if (r.catchUpRecommendation > 0) {
      out[r.goalId] = r.catchUpRecommendation;
    }
  }
  return out;
}
