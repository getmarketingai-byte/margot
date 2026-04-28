import type { GeneratedEvent, WeatherSettings } from "@calendar-automations/schema";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Interval {
  startMs: number;
  endMs: number;
  source: "weather" | "sun";
}

interface OpenMeteoHourly {
  time: string[];
  temperature_2m: number[];
  precipitation_probability: number[];
  windspeed_10m: number[];
  uv_index: number[];
  is_day: number[];
}

interface OpenMeteoResponse {
  hourly?: OpenMeteoHourly;
}

interface SunriseSunsetResponse {
  results?: {
    sunrise?: string;
    sunset?: string;
  };
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

async function fetchWeather(weather: WeatherSettings): Promise<OpenMeteoResponse> {
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

async function fetchSunriseSunset(
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
  const json = (await res.json()) as SunriseSunsetResponse;
  const sunrise = json.results?.sunrise ? Date.parse(json.results.sunrise) : NaN;
  const sunset = json.results?.sunset ? Date.parse(json.results.sunset) : NaN;
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset) || sunset <= sunrise) return null;
  return { sunriseMs: sunrise, sunsetMs: sunset };
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
}): Promise<GeneratedEvent[]> {
  const { userId, windowStartMs, windowEndMs, weather, stableUid } = params;
  if (!weather.enabled) return [];
  if (windowEndMs <= windowStartMs) return [];

  const outside: Interval[] = [];
  try {
    const raw = await fetchWeather(weather);
    const hourly = raw.hourly;
    if (!hourly || hourly.time.length === 0) return [];
    let inNice = false;
    let currentStartMs = 0;
    let lastForecastStopMs = 0;

    for (let i = 0; i < hourly.time.length; i++) {
      const timeMs = Date.parse(hourly.time[i]!);
      if (!Number.isFinite(timeMs)) continue;
      const hourlyPoint = {
        precipitation_probability: hourly.precipitation_probability[i] ?? 100,
        temperature_2m: hourly.temperature_2m[i] ?? -999,
        windspeed_10m: hourly.windspeed_10m[i] ?? 999,
        uv_index: hourly.uv_index[i] ?? 999,
        is_day: hourly.is_day[i] ?? 0
      };
      const nice = isNiceWeather(hourlyPoint, weather);
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
      weather.useSunriseSunsetBeyondForecast || weather.extendInsideOutsideBeyondForecast;
    if (shouldUseSun && outside.length > 0) {
      const lastStop = Math.max(...outside.map((i) => i.endMs));
      const firstSunDayParts = toDateParts(lastStop + DAY_MS, weather.timezone);
      let dayCursor = utcMsForLocalDateAtHour(
        firstSunDayParts.year,
        firstSunDayParts.month,
        firstSunDayParts.day,
        6,
        0,
        weather.timezone
      );
      while (dayCursor <= windowEndMs) {
        const sun = await fetchSunriseSunset(weather.latitude, weather.longitude, dayCursor, weather.timezone);
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

  const mergedOutside = mergeIntervals(
    outside
      .map((i) => ({
        startMs: Math.max(windowStartMs, i.startMs),
        endMs: Math.min(windowEndMs, i.endMs),
        source: i.source
      }))
      .filter((i) => i.endMs > i.startMs)
  );

  const inside = invertIntervals(windowStartMs, windowEndMs, mergedOutside, true, weather.timezone);
  if (weather.extendInsideOutsideBeyondForecast) {
    for (const out of mergedOutside) {
      if (out.source === "sun") inside.push({ startMs: out.startMs, endMs: out.endMs });
    }
  }

  const dedupInside = new Map<string, { startMs: number; endMs: number }>();
  for (const i of inside) {
    if (i.endMs <= i.startMs) continue;
    dedupInside.set(`${i.startMs}_${i.endMs}`, i);
  }

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
  for (const i of dedupInside.values()) {
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
