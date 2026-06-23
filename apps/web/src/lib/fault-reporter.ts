/**
 * Client-side fault reporter.
 * Sends errors to POST /api/faults without blocking the UI.
 */

export interface FaultPayload {
  type: "404" | "500" | "client_error" | "api_error" | "unknown";
  statusCode?: number | undefined;
  path: string;
  message: string;
  stack?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export async function reportFault(payload: FaultPayload): Promise<void> {
  try {
    await fetch("/api/faults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Silently ignore — fault reporting should never cause its own errors
  }
}
