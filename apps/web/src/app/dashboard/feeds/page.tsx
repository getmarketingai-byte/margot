import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function FeedsPage() {
  redirect("/dashboard/calendars#ical-feeds");
}
