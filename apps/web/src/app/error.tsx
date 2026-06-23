"use client";

import { useEffect } from "react";
import { reportFault } from "@/lib/fault-reporter";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps) {
  useEffect(() => {
    reportFault({
      type: "500",
      statusCode: 500,
      path: typeof window !== "undefined" ? window.location.pathname : "unknown",
      message: error.message || "An unexpected error occurred",
      stack: error.stack ?? undefined,
      metadata: {
        digest: error.digest ?? undefined,
        name: error.name,
      },
    });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 text-center p-8">
      <div className="space-y-2">
        <h1 className="text-6xl font-bold text-muted-foreground">500</h1>
        <h2 className="text-2xl font-semibold">Something went wrong</h2>
        <p className="text-muted-foreground max-w-md">
          An unexpected error occurred. It has been reported automatically and
          we&apos;ll look into it.
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
