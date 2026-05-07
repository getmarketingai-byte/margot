import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";

export const dynamic = "force-dynamic";

export default async function DashboardHome() {
  const ua = userAgent({ headers: await headers() });
  const target =
    ua.device.type === "mobile" ? "/dashboard/review" : "/dashboard/plan";
  redirect(target);
}
