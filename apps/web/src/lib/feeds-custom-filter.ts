/**
 * Applies user-defined ICS include rules against snapshot-generated events (OR semantics).
 */

import type { GeneratedEvent } from "@margot/schema";
import type { IcsFeedRules } from "@margot/schema";

export function tagSet(event: GeneratedEvent): ReadonlySet<string> {
  return new Set(event.tags ?? []);
}

function hasGoalLikeKind(e: GeneratedEvent): boolean {
  return e.kind === "weekly-goal" || e.kind === "consistency-segment";
}

/** Inverted-calendar readouts (`inverted-calendar`) plus rare system-derived timemap tags. */
export function eventIsInvertedTimemap(e: GeneratedEvent): boolean {
  if (e.kind !== "timemap") return false;
  const tags = tagSet(e);
  return tags.has("inverted-calendar") || tags.has("inverted-timemap");
}

export function eventIsWeatherTimemap(e: GeneratedEvent): boolean {
  return e.kind === "timemap" && tagSet(e).has("weather");
}

export function eventIsGenericTravel(e: GeneratedEvent): boolean {
  const tags = tagSet(e);
  return e.kind === "travel" && !tags.has("gym-pad") && !tags.has("drive-arrival-buffer");
}

export function eventIsGymPad(e: GeneratedEvent): boolean {
  return tagSet(e).has("gym-pad");
}

export function eventIsGymGoalBlock(e: GeneratedEvent): boolean {
  if (!hasGoalLikeKind(e)) return false;
  return [...tagSet(e)].some((t) => t === "special:gym");
}

function goalTagMatches(includeId: readonly string[]): (e: GeneratedEvent) => boolean {
  const wanted = new Set(includeId.map((id) => `goal:${id}`));
  return (e: GeneratedEvent) => {
    for (const tag of tagSet(e)) {
      if (wanted.has(tag)) return true;
    }
    return false;
  };
}

function groupTagMatches(includeId: readonly string[]): (e: GeneratedEvent) => boolean {
  const wanted = new Set(includeId.map((id) => `group:${id}`));
  return (e: GeneratedEvent) => {
    for (const tag of tagSet(e)) {
      if (wanted.has(tag)) return true;
    }
    return false;
  };
}

/**
 * Keeps snapshot events matching any enabled rule. Empty `include` yields an empty calendar.
 */
export function filterEventsForCustomRules(
  events: readonly GeneratedEvent[],
  rules: IcsFeedRules
): GeneratedEvent[] {
  const inc = rules.include;
  return events.filter(
    (e) => !tagSet(e).has("drive-arrival-buffer") && matchesCustomInclude(e, inc)
  );
}

function matchesCustomInclude(e: GeneratedEvent, inc: IcsFeedRules["include"]): boolean {
  if (inc.allGoalsAndSegments && hasGoalLikeKind(e)) return true;
  if (inc.goalIds?.length && goalTagMatches(inc.goalIds)(e)) return true;
  if (inc.groupIds?.length && groupTagMatches(inc.groupIds)(e)) return true;
  if (inc.sleep && e.kind === "sleep") return true;
  if (inc.routine && e.kind === "routine") return true;
  if (inc.genericTravel && eventIsGenericTravel(e)) return true;
  if (inc.gymPads && eventIsGymPad(e)) return true;
  if (inc.gymGoals && eventIsGymGoalBlock(e)) return true;
  if (inc.weatherTimemap && eventIsWeatherTimemap(e)) return true;
  if (inc.invertedTimemap && eventIsInvertedTimemap(e)) return true;
  if (inc.weeklyReview && e.kind === "weekly-review") return true;
  if (inc.monthlyStrategy && e.kind === "monthly-strategy") return true;
  if (inc.errand && e.kind === "errand") return true;
  return false;
}
