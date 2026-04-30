"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { measureNavigationInteractive } from "@/lib/ui-perf";

/**
 * Estimates dashboard route transition readiness (pathname change → idle frame after paint).
 */
export function DashboardPerfListener() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname == null || typeof performance === "undefined") return;
    const t0 = performance.now();
    const id = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        measureNavigationInteractive(pathname, t0);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
