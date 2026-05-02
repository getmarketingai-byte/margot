import { z } from "zod";

/**
 * Inclusion rules for a user-defined ICS feed. Union (OR): an event matches
 * if any enabled criterion matches (see apps/web/src/lib/feeds-custom-filter.ts).
 */
export const icsFeedRulesIncludeSchema = z.object({
  allGoalsAndSegments: z.boolean().optional(),
  goalIds: z.array(z.string().min(1)).max(512).optional(),
  groupIds: z.array(z.string().min(1)).max(64).optional(),
  sleep: z.boolean().optional(),
  routine: z.boolean().optional(),
  genericTravel: z.boolean().optional(),
  gymGoals: z.boolean().optional(),
  gymPads: z.boolean().optional(),
  weatherTimemap: z.boolean().optional(),
  invertedTimemap: z.boolean().optional(),
  weeklyReview: z.boolean().optional(),
  monthlyStrategy: z.boolean().optional(),
  errand: z.boolean().optional()
});

export type IcsFeedRulesInclude = z.infer<typeof icsFeedRulesIncludeSchema>;

export const icsFeedRulesSchema = z.object({
  version: z.literal(1),
  include: icsFeedRulesIncludeSchema.default({})
});

export type IcsFeedRules = z.infer<typeof icsFeedRulesSchema>;

/** Default closed rules until the user configures (invalid for save until hasSelection). */
export function emptyIcsFeedRules(): IcsFeedRules {
  return { version: 1, include: {} };
}

export function parseIcsFeedRules(raw: unknown): IcsFeedRules {
  return icsFeedRulesSchema.parse(raw);
}

export function icsFeedRulesHasSelection(include: IcsFeedRulesInclude): boolean {
  if (include.allGoalsAndSegments) return true;
  if (include.goalIds?.length) return true;
  if (include.groupIds?.length) return true;
  const toggles = [
    include.sleep,
    include.routine,
    include.genericTravel,
    include.gymGoals,
    include.gymPads,
    include.weatherTimemap,
    include.invertedTimemap,
    include.weeklyReview,
    include.monthlyStrategy,
    include.errand
  ];
  return toggles.some(Boolean);
}
