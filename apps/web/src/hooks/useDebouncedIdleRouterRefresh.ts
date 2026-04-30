"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Debounced soft refresh — reconciles allocator metrics/SR props after bursts
 * of optimistic edits without blocking each interaction.
 */
export function useDebouncedIdleRouterRefresh(debounceMs = 900, idleTimeoutMs = 2200): () => void {
  const router = useRouter();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleId = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (idleId.current != null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId.current);
      }
    };
  }, []);

  const schedule = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      if (typeof window !== "undefined" && typeof requestIdleCallback === "function") {
        if (idleId.current != null) cancelIdleCallback(idleId.current);
        idleId.current = requestIdleCallback(() => router.refresh(), { timeout: idleTimeoutMs });
      } else {
        router.refresh();
      }
    }, debounceMs);
  }, [router, debounceMs, idleTimeoutMs]);

  return schedule;
}
