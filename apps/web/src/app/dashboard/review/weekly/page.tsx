import { redirect } from "next/navigation";

/** Legacy URL — week review lives at `/dashboard/week-review`. */
export default function WeeklyReviewRedirectPage() {
  redirect("/dashboard/week-review");
}
