/**
 * Server-side cache for Open-Meteo hourly payloads and sunrise-sunset.org hits.
 * Matches the Google busy snapshot pattern: serve the last persisted fetch quickly,
 * optionally enqueue a quiet Open-Meteo refresh via Next `after()` once it ages out.
 */

import "server-only";

import { createHash } from "crypto";
import { after } from "next/server";
import { eq } from "drizzle-orm";
import type { WeatherSettings } from "@calendar-automations/schema";
import { invalidateUserAllocationCache } from "@/lib/allocation-cache-invalidation";
import { db, schema } from "@/lib/db";

export interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  windspeed_10m: number[];
  uv_index: number[];
  is_day: number[];
}

export interface OpenMeteoResponse {
  hourly?: OpenMeteoHourly;
}

interface SunriseSunsetApiResponse {
  results?: {
    sunrise?: string;
    sunset?: string;
  };
}

type SunriseEntry = { sunriseMs: number; sunsetMs: number; fetchedAtMs: number };

const OPENMETEO_BACKGROUND_REFRESH_MS = 25 * 60 * 1000;
/** Per calendar date; sunrise times are stable enough that ~36h reuse is fine. */
const SUNRISE_ENTRY_MAX_AGE_MS = 36 * 60 * 60 * 1000;

function toDateParts(ms: number, timezone: string): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = fmt.formatToParts(new Date(ms)).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function isoDateKey(dateMs: number, timezone: string): string {
  const d = toDateParts(dateMs, timezone);
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

export function weatherCoordsFingerprint(w: {
  latitude: number;
  longitude: number;
  timezone: string;
}): string {
  const lat = Math.round(w.latitude * 1e5) / 1e5;
  const lng = Math.round(w.longitude * 1e5) / 1e5;
  return createHash("sha256").update(JSON.stringify({ lat, lng, tz: w.timezone })).digest("hex").slice(0, 48);
}

async function fetchOpenMeteoFresh(weather: WeatherSettings): Promise<OpenMeteoResponse> {
  const params = new URLSearchParams({
    latitude: String(weather.latitude),
    longitude: String(weather.longitude),
    timezone: weather.timezone,
    forecast_days: "16",
    hourly: "temperature_2m,precipitation_probability,windspeed_10m,uv_index,is_day"
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    method: "GET",
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);
  return (await res.json()) as OpenMeteoResponse;
}

async function fetchSunriseSunsetFresh(
  latitude: number,
  longitude: number,
  dateMs: number,
  timezone: string
): Promise<{ sunriseMs: number; sunsetMs: number } | null> {
  const d = toDateParts(dateMs, timezone);
  const date = `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const url = `https://api.sunrise-sunset.org/json?lat=${latitude}&lng=${longitude}&date=${date}&formatted=0`;
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) return null;
  const json = (await res.json()) as SunriseSunsetApiResponse;
  const sunrise = json.results?.sunrise ? Date.parse(json.results.sunrise) : NaN;
  const sunset = json.results?.sunset ? Date.parse(json.results.sunset) : NaN;
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset) || sunset <= sunrise) return null;
  return { sunriseMs: sunrise, sunsetMs: sunset };
}

type CacheRowShape = {
  coordsFingerprint: string;
  openMeteoJson: unknown | null;
  openMeteoFetchedAtMs: string;
  sunriseByDate: Record<string, SunriseEntry>;
};

export class WeatherForecastCacheSession {
  private loaded = false;

  private memo: CacheRowShape | null = null;

  constructor(private readonly userId: string) {}

  private async ensureRow(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!db) {
      this.memo = null;
      return;
    }
    const rows = await db
      .select()
      .from(schema.weatherForecastCache)
      .where(eq(schema.weatherForecastCache.userId, this.userId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      this.memo = null;
      return;
    }
    this.memo = {
      coordsFingerprint: row.coordsFingerprint,
      openMeteoJson: row.openMeteoJson,
      openMeteoFetchedAtMs: row.openMeteoFetchedAtMs,
      sunriseByDate: (row.sunriseByDate as Record<string, SunriseEntry>) ?? {}
    };
  }

  private async persist(next: CacheRowShape): Promise<void> {
    if (!db) return;
    this.memo = next;
    this.loaded = true;
    await db
      .insert(schema.weatherForecastCache)
      .values({
        userId: this.userId,
        updatedAt: new Date(),
        coordsFingerprint: next.coordsFingerprint,
        openMeteoJson: next.openMeteoJson,
        openMeteoFetchedAtMs: next.openMeteoFetchedAtMs,
        sunriseByDate: next.sunriseByDate
      })
      .onConflictDoUpdate({
        target: schema.weatherForecastCache.userId,
        set: {
          updatedAt: new Date(),
          coordsFingerprint: next.coordsFingerprint,
          openMeteoJson: next.openMeteoJson,
          openMeteoFetchedAtMs: next.openMeteoFetchedAtMs,
          sunriseByDate: next.sunriseByDate
        }
      });
  }

  async getOpenMeteo(weatherAtHome: WeatherSettings): Promise<OpenMeteoResponse> {
    if (!db) return fetchOpenMeteoFresh(weatherAtHome);

    await this.ensureRow();
    const fp = weatherCoordsFingerprint(weatherAtHome);
    const row = this.memo;
    const openMeteoAge =
      row && row.openMeteoJson != null && row.coordsFingerprint === fp
        ? Date.now() - Number(row.openMeteoFetchedAtMs || 0)
        : Infinity;

    const cacheHit =
      row != null &&
      row.coordsFingerprint === fp &&
      row.openMeteoJson != null &&
      Number.isFinite(openMeteoAge);

    if (cacheHit) {
      if (openMeteoAge >= OPENMETEO_BACKGROUND_REFRESH_MS) {
        after(async () => {
          try {
            const fresh = await fetchOpenMeteoFresh(weatherAtHome);
            const prevRows = await db!
              .select()
              .from(schema.weatherForecastCache)
              .where(eq(schema.weatherForecastCache.userId, this.userId))
              .limit(1);
            const prev = prevRows[0];
            const keepSunrise =
              prev && prev.coordsFingerprint === fp
                ? ((prev.sunriseByDate as Record<string, SunriseEntry>) ?? {})
                : {};
            await db!
              .insert(schema.weatherForecastCache)
              .values({
                userId: this.userId,
                updatedAt: new Date(),
                coordsFingerprint: fp,
                openMeteoJson: fresh,
                openMeteoFetchedAtMs: String(Date.now()),
                sunriseByDate: keepSunrise
              })
              .onConflictDoUpdate({
                target: schema.weatherForecastCache.userId,
                set: {
                  updatedAt: new Date(),
                  coordsFingerprint: fp,
                  openMeteoJson: fresh,
                  openMeteoFetchedAtMs: String(Date.now()),
                  sunriseByDate: keepSunrise
                }
              });
            invalidateUserAllocationCache(this.userId);
          } catch (err) {
            console.error("[weather-forecast-cache] background Open-Meteo refresh failed", err);
          }
        });
      }
      return row.openMeteoJson as OpenMeteoResponse;
    }

    const preservedSunrise =
      row && row.coordsFingerprint === fp ? { ...row.sunriseByDate } : {};
    const fresh = await fetchOpenMeteoFresh(weatherAtHome);
    const nowMs = Date.now();
    await this.persist({
      coordsFingerprint: fp,
      openMeteoJson: fresh,
      openMeteoFetchedAtMs: String(nowMs),
      sunriseByDate: preservedSunrise
    });
    invalidateUserAllocationCache(this.userId);
    return fresh;
  }

  async getSunriseSunset(
    latitude: number,
    longitude: number,
    dateMs: number,
    timezone: string
  ): Promise<{ sunriseMs: number; sunsetMs: number } | null> {
    if (!db) return fetchSunriseSunsetFresh(latitude, longitude, dateMs, timezone);

    await this.ensureRow();
    const fp = weatherCoordsFingerprint({ latitude, longitude, timezone });
    const iso = isoDateKey(dateMs, timezone);
    const row = this.memo;

    const sunriseMap =
      row && row.coordsFingerprint === fp ? { ...row.sunriseByDate } : {};
    const hit = sunriseMap[iso];
    const age = hit ? Date.now() - hit.fetchedAtMs : Infinity;
    if (hit && age < SUNRISE_ENTRY_MAX_AGE_MS) {
      return { sunriseMs: hit.sunriseMs, sunsetMs: hit.sunsetMs };
    }

    const fresh = await fetchSunriseSunsetFresh(latitude, longitude, dateMs, timezone);
    if (!fresh) return null;

    const baseOpen =
      row && row.coordsFingerprint === fp
        ? {
            openMeteoJson: row.openMeteoJson,
            openMeteoFetchedAtMs: row.openMeteoFetchedAtMs
          }
        : { openMeteoJson: null as unknown | null, openMeteoFetchedAtMs: "0" };

    await this.persist({
      coordsFingerprint: fp,
      ...baseOpen,
      sunriseByDate: {
        ...sunriseMap,
        [iso]: { ...fresh, fetchedAtMs: Date.now() }
      }
    });
    invalidateUserAllocationCache(this.userId);
    return fresh;
  }
}

export function createWeatherForecastCacheSession(userId: string): WeatherForecastCacheSession {
  return new WeatherForecastCacheSession(userId);
}
