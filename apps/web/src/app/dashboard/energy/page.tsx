import { redirect } from "next/navigation";

/** Legacy Planning hub route; bookmarks redirect to Planner. */
export default function LegacyEnergyPlannerRedirectPage() {
  redirect("/dashboard/planner");
}
