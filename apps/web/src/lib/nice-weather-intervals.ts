import type { GeneratedEvent } from "@margot/schema";
import type { Interval } from "@margot/planner";

/**
 * Timemap "[Outside]" events from `buildWeatherTimemapEvents`, clipped to an
 * allocator window for `allocateWeek({ niceWeatherWindows })`.
 */
export function outsideNiceWeatherIntervalsInRange(
  weatherEvents: readonly GeneratedEvent[],
  rangeStartMs: number,
  rangeEndMs: number
): Interval[] {
  const out: Interval[] = [];
  for (const e of weatherEvents) {
    if (e.title !== "[Outside]") continue;
    if (e.endMs <= rangeStartMs || e.startMs >= rangeEndMs) continue;
    const startMs = Math.max(rangeStartMs, e.startMs);
    const endMs = Math.min(rangeEndMs, e.endMs);
    if (endMs > startMs) out.push({ startMs, endMs });
  }
  return out;
}
