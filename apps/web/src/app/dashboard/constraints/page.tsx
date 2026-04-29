import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** @deprecated Scheduling rules now live on Planning (`/dashboard/energy`). */
export default function ConstraintsRedirectPage() {
  redirect("/dashboard/energy#scheduling-constraints");
}
