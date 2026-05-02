/**
 * Planner goal drag override keys: `goal:<weekAnchorIso>:<slotIndex>:<goalId>`
 * (`goalId` may contain `:`).
 */
export function parseGoalOverrideKey(key: string): { goalId: string } | null {
  const m = /^goal:[\d-]{10}:\d+:(.+)$/.exec(key);
  if (!m?.[1]) return null;
  return { goalId: m[1] };
}
