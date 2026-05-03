/**
 * OpenRouteService driver for the LegResolver.
 *
 * Why a separate file? `index.ts` owns the cache + budget logic; the actual
 * provider sits behind a tiny `RoutingProviderClient` interface so we can:
 *   1. Stub a Google Distance Matrix variant later behind the same shape.
 *   2. Inject a fake client in tests without spinning up real HTTP.
 *
 * Why two endpoints? OpenRouteService Directions takes coordinates, not
 * addresses. We use Nominatim (OpenStreetMap) for free geocoding and
 * cache the result per address so each unique address only ever costs one
 * geocode lookup across the user's lifetime — re-geocoding is gated by the
 * same staleness check as the leg cache itself.
 *
 * Rate limits to respect:
 *   - Nominatim: 1 req/sec, must include a User-Agent.
 *   - OpenRouteService free tier: 2,000 req/day, 40 req/min.
 *
 * The resolver enforces a per-render call budget on top of these (default 20).
 */

import type { GeocodeCacheEntry } from "@calendar-automations/schema";
import { geocodeAddressToCoords } from "../geocode-address";

const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

function normalizeOrsApiKey(raw: string | undefined): string | null {
  if (raw == null) return null;
  let t = raw.trim();
  if (t === "") return null;
  if (t.toLowerCase().startsWith("bearer ")) {
    t = t.slice(7).trim();
  }
  return t === "" ? null : t;
}

export interface RoutingProviderContext {
  geocodes: Map<string, GeocodeCacheEntry>;
  /** When true, OpenRouteService omits toll roads (`avoid_features: ["tollways"]`). */
  avoidTolls?: boolean;
}

export interface RoutingProviderClient {
  /**
   * Returns drive duration from origin to dest in minutes, or null when the
   * leg can't be resolved. Implementations may mutate the provided
   * `geocodes` map to cache resolved coordinates.
   */
  duration(origin: string, dest: string, ctx: RoutingProviderContext): Promise<number | null>;
}

interface Coords {
  lat: number;
  lng: number;
}

async function driveSeconds(
  origin: Coords,
  dest: Coords,
  apiKey: string,
  avoidTolls: boolean
): Promise<number | null> {
  let res: Response;
  try {
    const body: Record<string, unknown> = {
      // ORS expects [lng, lat] pairs.
      coordinates: [
        [origin.lng, origin.lat],
        [dest.lng, dest.lat]
      ],
      units: "m",
      instructions: false
    };
    if (avoidTolls) {
      body.options = { avoid_features: ["tollways"] };
    }
    res = await fetch(ORS_DIRECTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body)
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | { routes?: Array<{ summary?: { duration?: number } }> }
    | null;
  const seconds = json?.routes?.[0]?.summary?.duration;
  if (typeof seconds !== "number" || seconds <= 0) return null;
  return seconds;
}

/**
 * Build the default OpenRouteService client. Returns null when the env var
 * is missing — callers detect this and skip the provider entirely (still
 * falling back to `fallbackDurationMinutes`).
 */
export function createOpenRouteServiceProvider(): RoutingProviderClient | null {
  const apiKey = normalizeOrsApiKey(process.env.OPENROUTESERVICE_API_KEY);
  if (!apiKey) return null;

  return {
    async duration(origin, dest, ctx) {
      const nowMs = Date.now();
      const [originCoords, destCoords] = await Promise.all([
        geocodeAddressToCoords(origin, ctx.geocodes, nowMs),
        geocodeAddressToCoords(dest, ctx.geocodes, nowMs)
      ]);
      if (!originCoords || !destCoords) return null;

      const seconds = await driveSeconds(originCoords, destCoords, apiKey, ctx.avoidTolls === true);
      if (seconds == null) return null;
      return Math.ceil(seconds / 60);
    }
  };
}
