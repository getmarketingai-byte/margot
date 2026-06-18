"use client";

import { useEffect } from "react";

/**
 * Registers the Workbox service worker.
 * Rendered once inside the root layout.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      window.location.protocol === "https:"
    ) {
      navigator.serviceWorker
        .register("/service-worker.js", { scope: "/" })
        .then((registration) => {
          console.info("[SW] registered", registration.scope);
        })
        .catch((err: unknown) => {
          console.warn("[SW] registration failed", err);
        });
    }
  }, []);

  return null;
}
