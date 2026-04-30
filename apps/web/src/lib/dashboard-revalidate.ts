/**
 * Centralised dashboard cache invalidation for planning surfaces.
 * Avoids touching `/dashboard` (redirect-only) to cut unnecessary churn.
 */

import "server-only";

import { revalidatePath } from "next/cache";

/** Routes that consume weekly plan data + allocator context. */
const PLANNING_PATHS = ["/dashboard/plan", "/dashboard/energy"] as const;

export function revalidatePlanningRoutes(options?: {
  /** Also refresh review surfaces when plan-derived context must align (reviews, ICS, etc.). */
  includeReviews?: boolean;
}): void {
  for (const p of PLANNING_PATHS) {
    revalidatePath(p);
  }
  if (options?.includeReviews) {
    revalidatePath("/dashboard/review");
    revalidatePath("/dashboard/week-review");
  }
}
