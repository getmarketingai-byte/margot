"use client";

import React from "react";
import { reportFault } from "@/lib/fault-reporter";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

/**
 * ErrorBoundary catches unhandled client-side render errors and automatically
 * reports them to /api/faults.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    reportFault({
      type: "client_error",
      path: typeof window !== "undefined" ? window.location.pathname : "unknown",
      message: error.message,
      stack: error.stack ?? undefined,
      metadata: {
        componentStack: info.componentStack ?? undefined,
        name: error.name,
      },
    });
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[200px] p-8 text-center">
          <h2 className="text-lg font-semibold text-destructive mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            This error has been reported automatically.
          </p>
          <button
            className="text-sm underline text-muted-foreground hover:text-foreground"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
