/**
 * Shared address → coordinates resolution (lat,lng parse + Nominatim).
 * Used by travel routing and by settings / weather so one home string drives both.
 */

import type { GeocodeCacheEntry } from "@margot/schema";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "margot/1.0 (https://github.com/getmarketingai-byte)";
const GEOCODE_STALE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const LATLNG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

export function parseLatLngFromAddress(input: string): { lat: number; lng: number } | null {
  const m = input.match(LATLNG_RE);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Resolves a free-text address to coordinates, using the mutable geocode cache map.
 * Mutates `geocodes` when Nominatim returns a new hit (same keying as travel routing).
 */
export async function geocodeAddressToCoords(
  address: string,
  geocodes: Map<string, GeocodeCacheEntry>,
  nowMs: number
): Promise<{ lat: number; lng: number } | null> {
  const direct = parseLatLngFromAddress(address);
  if (direct) return direct;

  const key = address.trim().toLowerCase();
  if (!key) return null;
  const cached = geocodes.get(key);
  if (cached && nowMs - cached.fetchedAtMs < GEOCODE_STALE_MS) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(address)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
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
