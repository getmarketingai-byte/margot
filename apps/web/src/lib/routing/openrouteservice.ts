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

const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "calendar-automations/1.0 (https://github.com/marklewis)";
const GEOCODE_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface RoutingProviderClient {
  /**
   * Returns drive duration from origin to dest in minutes, or null when the
   * leg can't be resolved. Implementations may mutate the provided
   * `geocodes` map to cache resolved coordinates.
   */
  duration(
    origin: string,
    dest: string,
    ctx: { geocodes: Map<string, GeocodeCacheEntry> }
  ): Promise<number | null>;
}

interface Coords {
  lat: number;
  lng: number;
}

const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Tries to interpret a string as "lat,lng". Lets the user store coordinates
 * directly in `homeAddress` (e.g. "−37.910156,145.107420") to bypass
 * geocoding for the most-frequent leg in the cache.
 */
function parseLatLng(input: string): Coords | null {
  const m = input.match(LATLNG_RE);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function geocode(
  address: string,
  geocodes: Map<string, GeocodeCacheEntry>,
  nowMs: number
): Promise<Coords | null> {
  const direct = parseLatLng(address);
  if (direct) return direct;

  const key = address.trim().toLowerCase();
  const cached = geocodes.get(key);
  if (cached && nowMs - cached.fetchedAtMs < GEOCODE_STALE_MS) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      // Nominatim's TOS asks for caching; a 1-day revalidate is conservative.
      next: { revalidate: 86_400 }
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const json = (await res.json().catch(() => null)) as
    | Array<{ lat: string; lon: string }>
    | null;
  if (!Array.isArray(json) || json.length === 0) return null;
  const first = json[0]!;
  const lat = Number(first.lat);
  const lng = Number(first.lon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;

  geocodes.set(key, { lat, lng, fetchedAtMs: nowMs });
  return { lat, lng };
}

async function driveSeconds(origin: Coords, dest: Coords, apiKey: string): Promise<number | null> {
  let res: Response;
  try {
    res = await fetch(ORS_DIRECTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        // ORS expects [lng, lat] pairs.
        coordinates: [
          [origin.lng, origin.lat],
          [dest.lng, dest.lat]
        ],
        units: "m",
        instructions: false
      })
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
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey || apiKey.trim() === "") return null;

  return {
    async duration(origin, dest, ctx) {
      const nowMs = Date.now();
      const [originCoords, destCoords] = await Promise.all([
        geocode(origin, ctx.geocodes, nowMs),
        geocode(dest, ctx.geocodes, nowMs)
      ]);
      if (!originCoords || !destCoords) return null;

      const seconds = await driveSeconds(originCoords, destCoords, apiKey);
      if (seconds == null) return null;
      return Math.ceil(seconds / 60);
    }
  };
}
