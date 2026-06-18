/**
 * Margot Service Worker – Workbox 7 shell caching strategy.
 *
 * This file is compiled and placed at /service-worker.js by the build pipeline.
 * Registration happens in the root layout via a client component (see sw-register.tsx).
 *
 * Strategy summary:
 *  - App shell (HTML, JS, CSS) → CacheFirst with network fallback
 *  - API routes                → NetworkFirst (never cache auth/sensitive routes)
 *  - Static assets (images)    → CacheFirst with long TTL
 *  - Google Fonts              → StaleWhileRevalidate
 */

/// <reference lib="webworker" />
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import {
  registerRoute,
  setCatchHandler,
  setDefaultHandler,
} from "workbox-routing";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Precache app shell ────────────────────────────────────────────────────────
// Injected by Workbox at build time via InjectManifest plugin.
precacheAndRoute(self.__WB_MANIFEST ?? []);

// Remove stale precached assets from prior app versions
cleanupOutdatedCaches();

// ── SPA navigation handler ───────────────────────────────────────────────────
// All navigation requests that are not API calls fall back to the precached
// /index.html shell so client-side routing works offline.
registerRoute(
  ({ request, url }: { request: Request; url: URL }) =>
    request.mode === "navigate" && !url.pathname.startsWith("/api"),
  createHandlerBoundToURL("/")
);

// ── Static assets (images, fonts served locally) ─────────────────────────────
registerRoute(
  ({ request }: { request: Request }) =>
    request.destination === "image" ||
    request.destination === "font",
  new CacheFirst({
    cacheName: "margot-static-assets-v1",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
        purgeOnQuotaError: true,
      }),
    ],
  })
);

// ── Google Fonts ──────────────────────────────────────────────────────────────
registerRoute(
  ({ url }: { url: URL }) =>
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com",
  new StaleWhileRevalidate({
    cacheName: "margot-google-fonts-v1",
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 }),
    ],
  })
);

// ── API routes – network first, short cache ───────────────────────────────────
// Auth routes are explicitly excluded so sessions are never stale.
registerRoute(
  ({ url }: { url: URL }) =>
    url.pathname.startsWith("/api") &&
    !url.pathname.startsWith("/api/auth"),
  new NetworkFirst({
    cacheName: "margot-api-v1",
    networkTimeoutSeconds: 10,
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 5 * 60, // 5 minutes
      }),
    ],
  })
);

// ── Default handler (network) ─────────────────────────────────────────────────
setDefaultHandler(new NetworkFirst({ cacheName: "margot-default-v1" }));

// ── Offline fallback ──────────────────────────────────────────────────────────
setCatchHandler(async ({ request }: { request: Request }) => {
  if (request.destination === "document") {
    const cache = await caches.open("workbox-precache-v2");
    const cachedResponse = await cache.match("/");
    if (cachedResponse) return cachedResponse;
  }
  return Response.error();
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────
self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

// ── Push notifications (future) ───────────────────────────────────────────────
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;

  const data = event.data.json() as {
    title?: string;
    body?: string;
    icon?: string;
    url?: string;
  };

  event.waitUntil(
    self.registration.showNotification(data.title ?? "Margot", {
      body: data.body,
      icon: data.icon ?? "/icons/icon-192x192.png",
      badge: "/icons/icon-72x72.png",
      data: { url: data.url ?? "/" },
    })
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();

  const url = (event.notification.data as { url?: string }).url ?? "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url === url);
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      })
  );
});
