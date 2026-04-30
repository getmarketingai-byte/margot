"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const PREFETCH_HREFS = [
  "/dashboard/plan",
  "/dashboard/energy",
  "/dashboard/review",
  "/dashboard/week-review",
  "/dashboard/calendars"
] as const;

/** Warm dashboard RSC payloads on mount so switching tabs feels instant. */
export function DashboardRoutePrefetch() {
  const router = useRouter();
  useEffect(() => {
    for (const href of PREFETCH_HREFS) {
      router.prefetch(href);
    }
  }, [router]);
  return null;
}
