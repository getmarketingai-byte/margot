/**
 * Versioned UserSettings schema.
 *
 * Mirrors the domains of the legacy Apps Script Config.gs (calendars, timemap bands,
 * sleep, travel, weather, work / pay-period) and adds the new framework layers
 * (Wheel of Life, PPF, HP6 / HPP rhythms, consistency segments) introduced by the
 * next-generation web app.
 *
 * Each top-level slice is independently optional so onboarding can persist partial
 * progress; the planner package fills in defaults from `defaults.ts` at run time.
 */

import { z } from "zod";

export const SETTINGS_SCHEMA_VERSION = 1 as const;

const hour = z.number().int().min(0).max(23);
const minute = z.number().int().min(0).max(59);
const positiveInt = z.number().int().nonnegative();
const positiveNumber = z.number().nonnegative();

/* ──────────────────────────── 1. Calendars & sources ─────────────────────── */

export const calendarBusyModeSchema = z.enum([
  "ignore",
  "busy-only",
  "all-events",
  "invert-free-busy"
]);
export type CalendarBusyMode = z.infer<typeof calendarBusyModeSchema>;

export const calendarSourceSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["google", "microsoft", "ics"]),
  externalId: z.string().min(1),
  displayName: z.string().min(1),
  color: z.string().optional(),
  /**
   * Canonical busy-mode selector used by new UI surfaces.
   *
   * Optional for backwards compatibility with existing rows that only store
   * `countAsBusy`/`treatTransparentAsFree`.
   */
  busyMode: calendarBusyModeSchema.optional(),
  /**
   * Weekly-plan entry id used when `busyMode` is `invert-free-busy`: the planner
   * stores a labeled segment so free time on this calendar is exposed like other
   * time-map data (not a user-authored commitment goal).
   */
  availabilityGoalId: z.string().min(1).optional(),
  countAsBusy: z.boolean().default(true),
  treatTransparentAsFree: z.boolean().default(true)
});
export type CalendarSource = z.infer<typeof calendarSourceSchema>;

export function calendarBusyModeForSource(source: CalendarSource): CalendarBusyMode {
  if (source.busyMode) return source.busyMode;
  if (!source.countAsBusy) return "ignore";
  return source.treatTransparentAsFree ? "busy-only" : "all-events";
}

export function normaliseCalendarSource(source: CalendarSource): CalendarSource {
  const busyMode = calendarBusyModeForSource(source);
  return {
    ...source,
    busyMode,
    // Keep legacy booleans in sync so existing readers remain correct.
    countAsBusy: busyMode === "busy-only" || busyMode === "all-events",
    treatTransparentAsFree: busyMode !== "all-events",
    availabilityGoalId: busyMode === "invert-free-busy" ? source.availabilityGoalId : undefined
  };
}

export const calendarsSettingsSchema = z.object({
  sources: z.array(calendarSourceSchema).default([]),
  excludedNames: z.array(z.string()).default([]),
  schedulingWindowDays: positiveInt.max(365).default(60)
});
export type CalendarsSettings = z.infer<typeof calendarsSettingsSchema>;

/* ─────────────────────────── 2. Timemap bands & routines ─────────────────── */

export const timemapBandSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  targetHours: positiveNumber.max(24),
  minHours: positiveNumber.max(24)
});
export type TimemapBand = z.infer<typeof timemapBandSchema>;

export const timemapSettingsSchema = z.object({
  bands: z
    .array(timemapBandSchema)
    .default([
      { id: "needle-mover", title: "[1-Needle-Mover]", targetHours: 4, minHours: 2 },
      { id: "execute", title: "[2-Execute]", targetHours: 4, minHours: 2 },
      { id: "ops", title: "[3-Ops/Future]", targetHours: 4, minHours: 2 },
      { id: "play", title: "[4-Play]", targetHours: 4, minHours: 2 }
    ]),
  minBlockMinutes: positiveInt.default(30),
  cumulativeDeepWork: z.boolean().default(false),
  morningRoutine: z
    .object({
      enabled: z.boolean().default(false),
      title: z.string().default("[MorningRoutine]"),
      minutes: positiveInt.default(30)
    })
    .default({ enabled: false, title: "[MorningRoutine]", minutes: 30 }),
  shutdownRoutine: z
    .object({
      enabled: z.boolean().default(false),
      title: z.string().default("[ShutdownRoutine]"),
      minutes: positiveInt.default(30)
    })
    .default({ enabled: false, title: "[ShutdownRoutine]", minutes: 30 }),
  errands: z
    .object({
      title: z.string().default("[Errands]"),
      windowMinutes: positiveInt.default(60)
    })
    .default({ title: "[Errands]", windowMinutes: 60 }),
  treatSkedpalAsBusy: z.boolean().default(true)
});
export type TimemapSettings = z.infer<typeof timemapSettingsSchema>;

/* ─────────────────────────────── 3. Sleep ────────────────────────────────── */

export const sleepSettingsSchema = z.object({
  durationHours: positiveNumber.max(16).default(8),
  windowStartHour: hour.default(20),
  windowEndHour: hour.default(12),
  idealWakeHour: hour.default(7),
  idealWakeMinute: minute.default(0),
  bufferBeforeLeaveMinutes: positiveInt.default(60),
  bufferAfterDriveHomeMinutes: positiveInt.default(60),
  travelBufferRoundMinutes: positiveInt.default(15),
  minBlockHours: positiveNumber.default(4),
  ignoreEventTitles: z.array(z.string()).default(["Gym"])
});
export type SleepSettings = z.infer<typeof sleepSettingsSchema>;

/* ─────────────────────────────── 4. Travel ───────────────────────────────── */

export const routingProviderSchema = z.enum(["openrouteservice", "disabled"]);
export type RoutingProvider = z.infer<typeof routingProviderSchema>;

export const travelSettingsSchema = z.object({
  arriveMinutesBefore: positiveInt.default(15),
  minHomeMinutes: positiveInt.default(30),
  fallbackDurationMinutes: positiveInt.default(60),
  virtualLocationSubstrings: z.array(z.string()).default([
    "microsoft teams meeting",
    "teams meeting",
    "zoom",
    "google meet",
    "meet - ",
    "webex",
    "video call"
  ]),
  homeAddress: z.string().optional(),
  driveEventTag: z.string().default("[Drive]"),
  /**
   * Routing provider used to resolve real drive durations. When "disabled",
   * every drive falls back to `fallbackDurationMinutes`. The actual API key
   * is read from server-side env vars (`OPENROUTESERVICE_API_KEY`) and
   * intentionally NOT stored in user settings.
   */
  routingProvider: routingProviderSchema.default("disabled"),
  /**
   * Maximum number of provider calls allowed per page render. Caps cost on
   * the free tier and matches the legacy quota-budget loop in Travel.gs.
   */
  routingMaxCallsPerRender: positiveInt.default(20),
  /**
   * Stale-cache threshold in days. Cached leg durations older than this get
   * priority for refresh. Mirrors `TRAVEL_RECHECK_STALE_MS` from Config.gs.
   */
  routingStaleAfterDays: positiveInt.default(3)
});
export type TravelSettings = z.infer<typeof travelSettingsSchema>;

/* ──────────────── 4b. Travel cache (durations + geocodes) ────────────────── */

export const travelLegStateSchema = z.object({
  durationMin: positiveNumber,
  lastCheckedMs: z.number().int(),
  /** True when the value came from `fallbackDurationMinutes`, not from the provider. */
  usedFallback: z.boolean().default(false)
});
export type TravelLegState = z.infer<typeof travelLegStateSchema>;

export const geocodeCacheEntrySchema = z.object({
  lat: z.number(),
  lng: z.number(),
  fetchedAtMs: z.number().int()
});
export type GeocodeCacheEntry = z.infer<typeof geocodeCacheEntrySchema>;

export const travelCacheSchema = z.object({
  /** Map of "{originKey}\n{destKey}" → leg state. Keys are canonical (trimmed lowercase). */
  legs: z.record(z.string(), travelLegStateSchema).default({}),
  /** Map of canonical address string → cached geocode. */
  geocodes: z.record(z.string(), geocodeCacheEntrySchema).default({})
});
export type TravelCache = z.infer<typeof travelCacheSchema>;

/* ─────────────────────────────── 5. Gym ──────────────────────────────────── */

export const gymSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  title: z.string().default("Gym"),
  locationSubstring: z.string().optional(),
  driveMinutes: positiveInt.default(10),
  runMinutes: positiveInt.default(30),
  earliestStart: z
    .object({ hour: hour.default(6), minute: minute.default(0) })
    .default({ hour: 6, minute: 0 }),
  latestEnd: z
    .object({ hour: hour.default(20), minute: minute.default(0) })
    .default({ hour: 20, minute: 0 }),
  preferredExactStart: z
    .object({ hour: hour.default(11), minute: minute.default(30) })
    .default({ hour: 11, minute: 30 }),
  preferredWindow1: z
    .object({
      startHour: hour.default(11),
      startMinute: minute.default(0),
      endHour: hour.default(15),
      endMinute: minute.default(30)
    })
    .default({ startHour: 11, startMinute: 0, endHour: 15, endMinute: 30 }),
  preferredWindow2EndHour: hour.default(9),
  preferredWindow2EndMinute: minute.default(0),
  freeMinutesFull: positiveInt.default(360),
  freeMinutesMin: positiveInt.default(120)
});
export type GymSettings = z.infer<typeof gymSettingsSchema>;

/* ─────────────────────────── 6. Work / pay period ───────────────────────── */

export const workSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  referencePayPeriodStart: z.string().datetime().optional(),
  payPeriodDays: positiveInt.default(14),
  hourlyRate: positiveNumber.default(0),
  minWorkingMinutesPerPayPeriod: positiveInt.default(60),
  workNonWorkBufferMinutes: positiveInt.default(60),
  remainingHourEventStatusFree: z.boolean().default(true)
});
export type WorkSettings = z.infer<typeof workSettingsSchema>;

/* ─────────────────────────────── 7. Weather ──────────────────────────────── */

export const weatherSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  latitude: z.number().min(-90).max(90).default(-37.910156),
  longitude: z.number().min(-180).max(180).default(145.107420),
  timezone: z.string().default("Australia/Melbourne"),
  cacheMaxAgeDays: positiveInt.default(2),
  niceWeather: z
    .object({
      maxRainProbabilityPercent: positiveInt.default(25),
      minTempC: z.number().default(13),
      maxTempC: z.number().default(35),
      maxWindKmh: positiveNumber.default(50),
      maxUv: positiveNumber.default(8)
    })
    .default({
      maxRainProbabilityPercent: 25,
      minTempC: 13,
      maxTempC: 35,
      maxWindKmh: 50,
      maxUv: 8
    }),
  useSunriseSunsetBeyondForecast: z.boolean().default(false),
  extendInsideOutsideBeyondForecast: z.boolean().default(true)
});
export type WeatherSettings = z.infer<typeof weatherSettingsSchema>;

/* ───────────────────── 8. Wheel of Life (Tony Robbins) ───────────────────── */

export const wheelAreaSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Current satisfaction 1-10 (self-reported). */
  score: z.number().int().min(1).max(10).default(5),
  /** Optional weekly minute floor; planner will guarantee ≥ this many minutes. */
  minMinutesPerWeek: positiveInt.default(0)
});
export type WheelArea = z.infer<typeof wheelAreaSchema>;

const defaultWheelAreas: WheelArea[] = [
  { id: "physical-body", label: "Physical body", score: 5, minMinutesPerWeek: 0 },
  { id: "emotions-meaning", label: "Emotions & meaning", score: 5, minMinutesPerWeek: 0 },
  { id: "relationships", label: "Relationships", score: 5, minMinutesPerWeek: 0 },
  { id: "time", label: "Time", score: 5, minMinutesPerWeek: 0 },
  { id: "work-mission", label: "Work / career / mission", score: 5, minMinutesPerWeek: 0 },
  { id: "finances", label: "Finances", score: 5, minMinutesPerWeek: 0 },
  { id: "contribution", label: "Contribution", score: 5, minMinutesPerWeek: 0 },
  { id: "spirituality", label: "Spirituality", score: 5, minMinutesPerWeek: 0 }
];

export const wheelSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  areas: z.array(wheelAreaSchema).default(defaultWheelAreas)
});
export type WheelSettings = z.infer<typeof wheelSettingsSchema>;

/* ──────────────── 9. PPF (Personal / Professional / Financial) ───────────── */

export const ppfPillarKey = z.enum(["personal", "professional", "financial"]);
export type PpfPillarKey = z.infer<typeof ppfPillarKey>;

export const ppfHorizonKey = z.enum(["y1", "y3", "y5", "unspecified"]);
export type PpfHorizonKey = z.infer<typeof ppfHorizonKey>;

export const ppfTargetSchema = z.object({
  pillar: ppfPillarKey,
  /** Minimum percent of *discretionary* (non-busy) time to allocate this pillar. */
  minPercent: z.number().min(0).max(100).default(0),
  /** Minimum number of distinct slots per week for this pillar. */
  minTouchesPerWeek: positiveInt.default(0)
});
export type PpfTarget = z.infer<typeof ppfTargetSchema>;

export const ppfSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  targets: z.array(ppfTargetSchema).default([
    { pillar: "personal", minPercent: 0, minTouchesPerWeek: 0 },
    { pillar: "professional", minPercent: 0, minTouchesPerWeek: 0 },
    { pillar: "financial", minPercent: 0, minTouchesPerWeek: 0 }
  ])
});
export type PpfSettings = z.infer<typeof ppfSettingsSchema>;

/* ───────────── 10. HP6 / HPP rhythms (Brendon Burchard inspired) ─────────── */

export const hp6HabitKey = z.enum([
  "clarity",
  "energy",
  "necessity",
  "productivity",
  "influence",
  "courage"
]);
export type Hp6HabitKey = z.infer<typeof hp6HabitKey>;

export const hppRhythmSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  morningPrompts: z.array(z.string()).default([]),
  eveningScorecardPrompts: z.array(z.string()).default([]),
  weeklyReviewDay: z.enum([
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ]).default("sunday"),
  monthlyStrategyDayOfMonth: z.number().int().min(1).max(28).default(1),
  hp6MinTouchesPerMonth: z
    .record(hp6HabitKey, positiveInt)
    .default({
      clarity: 0,
      energy: 0,
      necessity: 0,
      productivity: 0,
      influence: 0,
      courage: 0
    })
});
export type HppRhythmSettings = z.infer<typeof hppRhythmSettingsSchema>;

/* ────────────── 11. Consistency / segments (Bustamante-style) ────────────── */

export const consistencySegmentSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Days of week (0=Sun … 6=Sat). */
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startHour: hour,
  startMinute: minute,
  durationMinutes: positiveInt,
  /** "non-negotiable" segments cannot be displaced by goal allocation. */
  nonNegotiable: z.boolean().default(false),
  energyMode: z.enum(["hyperfocus", "hyperaware", "neutral"]).default("neutral")
});
export type ConsistencySegment = z.infer<typeof consistencySegmentSchema>;

export const consistencySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  segments: z.array(consistencySegmentSchema).default([])
});
export type ConsistencySettings = z.infer<typeof consistencySettingsSchema>;

/* ─────────────────────────── 12. Energy ordering ─────────────────────────── */

export const energyOrderingSchema = z.object({
  /**
   * "strict": refuses to schedule hyperaware tasks before a hyperfocus warm-up.
   * "balanced": prefers but does not require the curve.
   * "ignore": purely chronological / priority-driven placement.
   */
  mode: z.enum(["strict", "balanced", "ignore"]).default("balanced"),
  preferredSequence: z
    .array(z.enum(["hyperfocus", "neutral", "hyperaware"]))
    .default(["hyperfocus", "neutral", "hyperaware"])
});
export type EnergyOrderingSettings = z.infer<typeof energyOrderingSchema>;

/* ─────────────────────────── 13. Allocator settings ──────────────────────── */

export const allocatorSettingsSchema = z.object({
  /**
   * What to do when the sum of goal minimums exceeds the available free time.
   *
   *   "proportional": scale every floor down by the same ratio so each goal
   *   still gets a fair share of what's available (default).
   *
   *   "strict": pay floors in goal-order until time runs out, leaving later
   *   goals at zero. Surfaces them in a "not scheduled this week" list.
   */
  starvationMode: z.enum(["proportional", "strict"]).default("proportional"),
  /**
   * How spare (unallocated) free time is distributed across goals after each
   * goal's `minMinutesPerWeek` floor has been reserved.
   *
   *   "even": split remaining minutes evenly across eligible goals so every
   *   goal grows by roughly the same amount (default; matches legacy behavior).
   *
   *   "finish-early": fill goals one after another in user/priority order,
   *   topping each up to its cap before moving to the next. Later goals may
   *   receive nothing, leaving the leftover free time as a single block of
   *   "finish early" time at the end of the day/week.
   */
  allocationMode: z.enum(["even", "finish-early"]).default("even")
});
export type AllocatorSettings = z.infer<typeof allocatorSettingsSchema>;

/* ──────────────────────────── Composite ─────────────────────────────────── */

export const userSettingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  timezone: z.string().default("Australia/Melbourne"),
  calendars: calendarsSettingsSchema.default({
    sources: [],
    excludedNames: [],
    schedulingWindowDays: 60
  }),
  timemap: timemapSettingsSchema.default({} as never),
  sleep: sleepSettingsSchema.default({} as never),
  travel: travelSettingsSchema.default({} as never),
  gym: gymSettingsSchema.default({} as never),
  work: workSettingsSchema.default({} as never),
  weather: weatherSettingsSchema.default({} as never),
  wheel: wheelSettingsSchema.default({} as never),
  ppf: ppfSettingsSchema.default({} as never),
  hpp: hppRhythmSettingsSchema.default({} as never),
  consistency: consistencySettingsSchema.default({} as never),
  energyOrdering: energyOrderingSchema.default({} as never),
  allocator: allocatorSettingsSchema.default({} as never),
  travelCache: travelCacheSchema.default({} as never)
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/* ───────────────── Migration helper (forward-compatible) ─────────────────── */

/**
 * Given a possibly-untyped settings JSON pulled from the database, parse it through
 * the current schema. Older versions can be upgraded here as new versions land.
 */
export function migrateSettings(raw: unknown): UserSettings {
  let parsed: UserSettings;
  if (raw && typeof raw === "object" && "schemaVersion" in raw) {
    const version = (raw as { schemaVersion: unknown }).schemaVersion;
    if (version === SETTINGS_SCHEMA_VERSION) {
      parsed = userSettingsSchema.parse(raw);
      parsed.calendars.sources = parsed.calendars.sources.map((source) =>
        normaliseCalendarSource(source)
      );
      return parsed;
    }
    // Future: if (version === 1) { raw = migrate1to2(raw); }
  }
  parsed = userSettingsSchema.parse({
    ...(raw as object | null | undefined),
    schemaVersion: SETTINGS_SCHEMA_VERSION
  });
  parsed.calendars.sources = parsed.calendars.sources.map((source) => normaliseCalendarSource(source));
  return parsed;
}
