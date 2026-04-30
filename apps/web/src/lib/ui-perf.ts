/**
 * Lightweight client instrumentation for UX latency (interaction → paint, server ACK).
 */

export type UiPerfEventName =
  | "interaction_perceived_first_paint"
  | "interaction_server_ack"
  | "navigation_time_to_mount";

declare global {
  interface Window {
    gtag?: (
      cmd: string,
      targetId: string,
      config?: Record<string, string | number | boolean | undefined>
    ) => void;
  }
}

function safeMark(name: string): void {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch {
    // duplicate mark name etc.
  }
}

function emitGtagTiming(name: string, valueMs: number): void {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  try {
    window.gtag("event", "timing_complete", {
      name,
      value: Math.round(Math.max(0, valueMs)),
      event_category: "ui_perf"
    });
  } catch {
    /* ignore analytics failures */
  }
}

/** Call right after synchronous optimistic UI commits (same tick as click handler). */
export function reportPerceivedInteraction(name: string, actionId: string): void {
  safeMark(`ui-perf-${actionId}-perceived`);
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[ui-perf] perceived ${name}`, actionId);
  }
}

export function measureServerAck(actionId: string, startPerfNow: number): void {
  if (typeof performance === "undefined" || typeof performance.now !== "function") return;
  const ms = performance.now() - startPerfNow;
  safeMark(`ui-perf-${actionId}-ack`);
  emitGtagTiming("server_action_roundtrip", ms);
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[ui-perf] server_ack ${Math.round(ms)}ms`, actionId);
  }
}

export function measureNavigationInteractive(pathname: string, navigationStartPerfNow: number): void {
  if (typeof performance === "undefined" || typeof performance.now !== "function") return;
  const ms = performance.now() - navigationStartPerfNow;
  emitGtagTiming("dashboard_nav_interactive", ms);
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.debug(`[ui-perf] nav_interactive ${Math.round(ms)}ms`, pathname);
  }
}
