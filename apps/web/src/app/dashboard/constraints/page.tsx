import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** @deprecated Scheduling options now live on the Planner hub (`/dashboard/planner`). */
export default function ConstraintsRedirectPage() {
  redirect("/dashboard/planner#scheduling-outcomes");
}
