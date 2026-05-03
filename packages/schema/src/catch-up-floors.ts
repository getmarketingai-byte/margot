/**
 * Maps goal rollups (or equivalent recommendation rows) to `catchUpFloors`
 * consumed by `allocateWeek`. Only positive suggestions are included — the allocator
 * applies them **after** Pass‑1/2 (+ group caps) as **goal-local** target+demand deltas,
 * not as Pass‑1 floor inflation (see ALLOCATOR_BUSINESS_RULES.md).
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
