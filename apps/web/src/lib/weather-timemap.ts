import type { GeneratedEvent, GeocodeCacheEntry, WeatherSettings } from "@calendar-automations/schema";
import { parseLatLngFromAddress } from "./geocode-address";
import { createWeatherForecastCacheSession } from "./weather-forecast-cache";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Interval {
  startMs: number;
  endMs: number;
  source: "weather" | "sun";
}

function toDateParts(ms: number, timezone: string): {
  year: number;
  month: number;
  day: number;
} {
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

function utcMsForLocalDateAtHour(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): number {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const localParts = dtf.formatToParts(new Date(naiveUtc)).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  const observedUtc = Date.UTC(
    Number(localParts.year),
    Number(localParts.month) - 1,
    Number(localParts.day),
    Number(localParts.hour),
    Number(localParts.minute),
    Number(localParts.second),
    0
  );
  return naiveUtc + (naiveUtc - observedUtc);
}

function isNiceWeather(
  hourly: {
    precipitation_probability: number;
    temperature_2m: number;
    windspeed_10m: number;
    uv_index: number;
    is_day: number;
  },
  weather: WeatherSettings
): boolean {
  const cfg = weather.niceWeather;
  if (hourly.precipitation_probability >= cfg.maxRainProbabilityPercent) return false;
  if (hourly.temperature_2m <= cfg.minTempC || hourly.temperature_2m >= cfg.maxTempC) return false;
  if (hourly.windspeed_10m >= cfg.maxWindKmh) return false;
  if (hourly.uv_index >= cfg.maxUv) return false;
  if (hourly.is_day === 0) return false;
  return true;
}

/**
 * Open-Meteo returns hourly `time` values in the requested timezone, usually
 * without an explicit offset (e.g. "2026-04-28T07:00"). Treating those as UTC
 * shifts blocks by ~10h for Australia/Melbourne. Parse as local wall-clock
 * in `timezone` instead.
 */
function parseOpenMeteoLocalHour(timeIsoLocal: string, timezone: string): number {
  // Fast path: if offset/Z is present, Date.parse is unambiguous.
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(timeIsoLocal)) {
    return Date.parse(timeIsoLocal);
  }
  const match = timeIsoLocal.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
  );
  if (!match) return Date.parse(timeIsoLocal);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  return utcMsForLocalDateAtHour(year, month, day, hour, minute, timezone);
}

function effectiveForecastCoordinates(
  weather: WeatherSettings,
  homeAddress: string | undefined,
  geocodes: Readonly<Record<string, GeocodeCacheEntry>> | undefined
): { latitude: number; longitude: number } {
  const home = homeAddress?.trim();
  if (!home) {
    return { latitude: weather.latitude, longitude: weather.longitude };
  }
  const parsed = parseLatLngFromAddress(home);
  if (parsed) return { latitude: parsed.lat, longitude: parsed.lng };
  const key = home.toLowerCase();
  const cached = geocodes?.[key];
  if (cached && typeof cached.lat === "number" && typeof cached.lng === "number") {
    return { latitude: cached.lat, longitude: cached.lng };
  }
  return { latitude: weather.latitude, longitude: weather.longitude };
}

function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startMs <= last.endMs) {
      if (cur.endMs > last.endMs) last.endMs = cur.endMs;
      // Prefer weather provenance if any merged segment is weather-backed.
      if (cur.source === "weather") last.source = "weather";
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Merges overlapping/adjacent ms ranges (no provenance). */
function mergeMsRanges(ranges: readonly { startMs: number; endMs: number }[]): { startMs: number; endMs: number }[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges]
    .filter((r) => r.endMs > r.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [];
  const out: { startMs: number; endMs: number }[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startMs <= last.endMs) {
      if (cur.endMs > last.endMs) last.endMs = cur.endMs;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/** Returns sub-ranges of [sMs, eMs) with merged busy blocks removed. */
function clipMsRangeAgainstBlocks(
  sMs: number,
  eMs: number,
  blocksMerged: readonly { startMs: number; endMs: number }[]
): { startMs: number; endMs: number }[] {
  if (eMs <= sMs) return [];
  if (blocksMerged.length === 0) return [{ startMs: sMs, endMs: eMs }];
  const out: { startMs: number; endMs: number }[] = [];
  let cur = sMs;
  for (const b of blocksMerged) {
    if (b.endMs <= cur) continue;
    if (b.startMs >= eMs) break;
    if (b.startMs > cur) out.push({ startMs: cur, endMs: Math.min(b.startMs, eMs) });
    cur = Math.max(cur, b.endMs);
    if (cur >= eMs) return out;
  }
  if (cur < eMs) out.push({ startMs: cur, endMs: eMs });
  return out;
}

function subtractSleepFromIntervals(intervals: readonly Interval[], blocks: { startMs: number; endMs: number }[]): Interval[] {
  if (blocks.length === 0) return [...intervals];
  const pieces: Interval[] = [];
  for (const iv of intervals) {
    for (const f of clipMsRangeAgainstBlocks(iv.startMs, iv.endMs, blocks)) {
      if (f.endMs <= f.startMs) continue;
      pieces.push({ startMs: f.startMs, endMs: f.endMs, source: iv.source });
    }
  }
  return mergeIntervals(pieces);
}

function invertIntervals(
  startMs: number,
  endMs: number,
  intervals: readonly Interval[],
  splitByDays: boolean,
  timezone: string
): Array<{ startMs: number; endMs: number }> {
  const merged = mergeIntervals(intervals);
  const out: Array<{ startMs: number; endMs: number }> = [];
  let cursor = startMs;
  for (const interval of merged) {
    if (interval.startMs > cursor) {
      out.push(...splitWindow(cursor, Math.min(interval.startMs, endMs), splitByDays, timezone));
    }
    if (interval.endMs > cursor) cursor = interval.endMs;
  }
  if (cursor < endMs) out.push(...splitWindow(cursor, endMs, splitByDays, timezone));
  return out.filter((i) => i.endMs > i.startMs);
}

function splitWindow(
  startMs: number,
  endMs: number,
  splitByDays: boolean,
  timezone: string
): Array<{ startMs: number; endMs: number }> {
  if (!splitByDays) return [{ startMs, endMs }];
  const out: Array<{ startMs: number; endMs: number }> = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const parts = toDateParts(cursor, timezone);
    const dayStart = utcMsForLocalDateAtHour(
      parts.year,
      parts.month,
      parts.day,
      0,
      0,
      timezone
    );
    const nextDayStart = dayStart + DAY_MS;
    const segEnd = Math.min(endMs, nextDayStart);
    if (segEnd > cursor) out.push({ startMs: cursor, endMs: segEnd });
    cursor = segEnd;
  }
  return out;
}

export async function buildWeatherTimemapEvents(params: {
  userId: string;
  windowStartMs: number;
  windowEndMs: number;
  weather: WeatherSettings;
  stableUid: (parts: readonly (string | number)[]) => string;
  /** When set, Open-Meteo / sunrise use coords from this string (see Travel home address). */
  homeAddress?: string;
  /** Canonical geocode cache (same keys as travel routing); optional read-only slice. */
  geocodes?: Readonly<Record<string, GeocodeCacheEntry>>;
  /** When set (e.g. computed sleep blocks), clips [Outside]/[Inside] so they do not overlap sleep. */
  sleepBlockMs?: readonly { startMs: number; endMs: number }[];
}): Promise<GeneratedEvent[]> {
  const { userId, windowStartMs, windowEndMs, weather, stableUid, sleepBlockMs, homeAddress, geocodes } =
    params;
  if (!weather.enabled) return [];
  if (windowEndMs <= windowStartMs) return [];

  const coords = effectiveForecastCoordinates(weather, homeAddress, geocodes);
  const weatherAtHome: WeatherSettings = {
    ...weather,
    latitude: coords.latitude,
    longitude: coords.longitude
  };

  const wxSession = createWeatherForecastCacheSession(userId);

  const outside: Interval[] = [];
  try {
    const raw = await wxSession.getOpenMeteo(weatherAtHome);
    const hourly = raw.hourly;
    if (!hourly || hourly.time.length === 0) return [];
    let inNice = false;
    let currentStartMs = 0;
    let lastForecastStopMs = 0;

    for (let i = 0; i < hourly.time.length; i++) {
      const timeMs = parseOpenMeteoLocalHour(hourly.time[i]!, weatherAtHome.timezone);
      if (!Number.isFinite(timeMs)) continue;
      const hourlyPoint = {
        precipitation_probability: hourly.precipitation_probability[i] ?? 100,
        temperature_2m: hourly.temperature_2m[i] ?? -999,
        windspeed_10m: hourly.windspeed_10m[i] ?? 999,
        uv_index: hourly.uv_index[i] ?? 999,
        is_day: hourly.is_day[i] ?? 0
      };
      const nice = isNiceWeather(hourlyPoint, weatherAtHome);
      if (timeMs >= windowStartMs - HOUR_MS && timeMs <= windowEndMs) {
        if (nice && !inNice) {
          inNice = true;
          currentStartMs = timeMs;
        } else if (!nice && inNice) {
          inNice = false;
          if (timeMs > currentStartMs) {
            outside.push({
              startMs: Math.max(currentStartMs, windowStartMs),
              endMs: Math.min(timeMs, windowEndMs),
              source: "weather"
            });
          }
        }
      }
      if (timeMs <= windowEndMs && timeMs > lastForecastStopMs) lastForecastStopMs = timeMs;
    }
    if (inNice) {
      const hardEnd = Math.min(windowEndMs, lastForecastStopMs + HOUR_MS);
      if (hardEnd > currentStartMs) {
        outside.push({
          startMs: Math.max(currentStartMs, windowStartMs),
          endMs: hardEnd,
          source: "weather"
        });
      }
    }

    const shouldUseSun =
      weatherAtHome.useSunriseSunsetBeyondForecast || weatherAtHome.extendInsideOutsideBeyondForecast;
    if (shouldUseSun && outside.length > 0) {
      const lastStop = Math.max(...outside.map((i) => i.endMs));
      const firstSunDayParts = toDateParts(lastStop + DAY_MS, weatherAtHome.timezone);
      let dayCursor = utcMsForLocalDateAtHour(
        firstSunDayParts.year,
        firstSunDayParts.month,
        firstSunDayParts.day,
        6,
        0,
        weatherAtHome.timezone
      );
      while (dayCursor <= windowEndMs) {
        const sun = await wxSession.getSunriseSunset(
          weatherAtHome.latitude,
          weatherAtHome.longitude,
          dayCursor,
          weatherAtHome.timezone
        );
        if (sun) {
          const s = Math.max(sun.sunriseMs, windowStartMs);
          const e = Math.min(sun.sunsetMs, windowEndMs);
          if (e > s) outside.push({ startMs: s, endMs: e, source: "sun" });
        }
        dayCursor += DAY_MS;
      }
    }
  } catch (err) {
    console.warn("buildWeatherTimemapEvents: weather generation failed", { userId, err });
    return [];
  }

  let mergedOutside = mergeIntervals(
    outside
      .map((i) => ({
        startMs: Math.max(windowStartMs, i.startMs),
        endMs: Math.min(windowEndMs, i.endMs),
        source: i.source
      }))
      .filter((i) => i.endMs > i.startMs)
  );

  const sleepMerged = mergeMsRanges(sleepBlockMs ?? []);
  mergedOutside = subtractSleepFromIntervals(mergedOutside, sleepMerged);

  const inside = invertIntervals(windowStartMs, windowEndMs, mergedOutside, true, weatherAtHome.timezone);
  if (weatherAtHome.extendInsideOutsideBeyondForecast) {
    for (const out of mergedOutside) {
      if (out.source === "sun") inside.push({ startMs: out.startMs, endMs: out.endMs });
    }
  }

  const dedupInside = new Map<string, { startMs: number; endMs: number }>();
  for (const i of inside) {
    if (i.endMs <= i.startMs) continue;
    dedupInside.set(`${i.startMs}_${i.endMs}`, i);
  }

  const insideAfterSleep: { startMs: number; endMs: number }[] = [];
  for (const i of dedupInside.values()) {
    insideAfterSleep.push(...clipMsRangeAgainstBlocks(i.startMs, i.endMs, sleepMerged));
  }
  const mergedInsideDisplay = mergeMsRanges(insideAfterSleep);

  const events: GeneratedEvent[] = [];
  for (const out of mergedOutside) {
    events.push({
      uid: stableUid([userId, "weather", "outside", out.startMs, out.endMs]),
      kind: "timemap",
      title: "[Outside]",
      startMs: out.startMs,
      endMs: out.endMs,
      busy: true,
      tags: ["weather", "outside"]
    });
  }
  for (const i of mergedInsideDisplay) {
    events.push({
      uid: stableUid([userId, "weather", "inside", i.startMs, i.endMs]),
      kind: "timemap",
      title: "[Inside]",
      startMs: i.startMs,
      endMs: i.endMs,
      busy: true,
      tags: ["weather", "inside"]
    });
  }
  return events.sort((a, b) => a.startMs - b.startMs);
}
