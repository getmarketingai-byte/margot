"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { reportFault } from "@/lib/fault-reporter";

export default function NotFound() {
  const pathname = usePathname();

  useEffect(() => {
    reportFault({
      type: "404",
      statusCode: 404,
      path: pathname ?? window.location.pathname,
      message: `Page not found: ${pathname ?? window.location.pathname}`,
    });
  }, [pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 text-center p-8">
      <div className="space-y-2">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <h2 className="text-2xl font-semibold">Page not found</h2>
        <p className="text-muted-foreground max-w-md">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          This has been reported automatically.
        </p>
      </div>
      <Link
        href="/dashboard"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
