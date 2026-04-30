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

/**
 * When true, the user should keep a non-empty home address: real routing and/or
 * weather-based outside blocks need coordinates derived from that string.
 */
export function settingsNeedHomeAddress(settings: {
  travel: Pick<TravelSettings, "routingProvider" | "homeAddress">;
  weather: Pick<WeatherSettings, "enabled">;
}): boolean {
  return settings.travel.routingProvider !== "disabled" || settings.weather.enabled;
}

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

/* ─────────────────────── 12b. Placement signal priority ─────────────────── */

/**
 * The four placement signals the allocator can use to nudge a goal's
 * preferred hour. Their default rank below mirrors today's implicit
 * dominance in `pickGapForGoal` / `scoreEnergyAwareness`: legacy `energyMode`
 * scoring is the strongest, followed by attention, layer, and polarity.
 */
export const placementSignalKey = z.enum([
  "energyMode",
  "attentionMode",
  "workLayer",
  "energyPolarity"
]);
export type PlacementSignalKey = z.infer<typeof placementSignalKey>;

export const placementPrioritySettingsSchema = z.object({
  /**
   * Ordered ranking of placement signals. Rank 0 is the most important.
   * The allocator scales each signal's contribution by its rank so the
   * top-ranked signal wins whenever two signals disagree about the ideal
   * hour for a goal.
   */
  order: z
    .array(placementSignalKey)
    .default(["energyMode", "attentionMode", "workLayer", "energyPolarity"])
});
export type PlacementPrioritySettings = z.infer<typeof placementPrioritySettingsSchema>;

/* ─────────────────────────── 12c. Long-horizon vision ────────────────────── */

/**
 * Long-horizon vision text persisted in user settings (not the per-week plan)
 * so it carries across weeks. PPF-aligned: an optional paragraph per pillar
 * plus an overall "north star" string. All fields are optional.
 */
export const visionSettingsSchema = z.object({
  northStar: z.string().max(4000).optional(),
  personal: z.string().max(4000).optional(),
  professional: z.string().max(4000).optional(),
  financial: z.string().max(4000).optional()
});
export type VisionSettings = z.infer<typeof visionSettingsSchema>;

/* ─────────────────────────── 13. Allocator settings ──────────────────────── */

export const allocatorSettingsSchema = z.object({
  /**
   * Whether catch-up floors come from day-sheet rollups automatically or only
   * from values you save on the week review (Apply). Automated uses a baseline
   * allocation to derive targets, then schedules extra floor minutes from
   * positive rollup recommendations.
   */
  catchUpMode: z.enum(["automated", "manual"]).default("automated"),
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
   * How unallocated time inside each calendar free window is laid out after goal
   * blocks are scheduled. Does not change weekly target minutes (Pass 2 always
   * splits post-floor remainder using `allocationSharePercent` / equal share).
   *
   *   "even" (default): spread slack in the window as equal gaps between
   *   consecutive goal runs, rather than one lump of empty time at the end.
   *
   *   "finish-early": do not insert those inter-goal buffers; blocks stay packed
   *   and leftover time in the window remains toward the end.
   */
  allocationMode: z.enum(["even", "finish-early"]).default("even")
});
export type AllocatorSettings = z.infer<typeof allocatorSettingsSchema>;

/* ─────────────────── 13b. Planning Hub scheduler framework inclusion ──────── */

/** Keys aligned with Planning Hub boards / allocator switches. */
export const schedulerFrameworkInclusionKeys = [
  "commitment",
  "polarity",
  "attention",
  "workLayer",
  "wheel",
  "ppfPillar",
  "ppfHorizon",
  "hp6"
] as const;
export type SchedulerFrameworkInclusionKey = (typeof schedulerFrameworkInclusionKeys)[number];

/**
 * Fine-grained control over which framework dimensions participate in allocator
 * behavior. Legacy `wheel.enabled` / `ppf.enabled` / `hpp.enabled` are kept in
 * sync on read/write via helpers below.
 */
export const schedulerFrameworkInclusionSchema = z.object({
  commitment: z.boolean().default(false),
  polarity: z.boolean().default(false),
  attention: z.boolean().default(false),
  workLayer: z.boolean().default(false),
  wheel: z.boolean().default(false),
  ppfPillar: z.boolean().default(false),
  ppfHorizon: z.boolean().default(false),
  hp6: z.boolean().default(false)
});
export type SchedulerFrameworkInclusion = z.infer<typeof schedulerFrameworkInclusionSchema>;

/**
 * Populate inclusion from legacy booleans only (used when migrating old JSON blobs).
 */
export function defaultSchedulerFrameworkInclusionFromLegacy(
  raw: Partial<{
    wheel: { enabled?: boolean };
    ppf: { enabled?: boolean };
    hpp: { enabled?: boolean };
  }>
): SchedulerFrameworkInclusion {
  const w = raw.wheel?.enabled ?? false;
  const p = raw.ppf?.enabled ?? false;
  const h = raw.hpp?.enabled ?? false;
  return {
    commitment: false,
    polarity: false,
    attention: false,
    workLayer: false,
    wheel: w,
    ppfPillar: p,
    /** Legacy had a single PPF toggle covering both pillar rules and horizon tagging. */
    ppfHorizon: p,
    hp6: h
  };
}

/**
 * Keep deprecated `wheel` / `ppf` / `hpp.enabled` booleans aligned with inclusion
 * so existing UI and planners that read `.enabled` stay consistent.
 */
export function syncLegacyFrameworkFlagsFromInclusion(settings: UserSettings): UserSettings {
  const inc = settings.schedulerFrameworkInclusion;
  return {
    ...settings,
    wheel: { ...settings.wheel, enabled: inc.wheel },
    ppf: { ...settings.ppf, enabled: inc.ppfPillar },
    hpp: { ...settings.hpp, enabled: inc.hp6 }
  };
}

/**
 * After callers mutate legacy `wheel` / `ppf` / `hpp.enabled` directly, reconcile
 * the three keyed inclusion fields with those booleans (`ppfHorizon` etc. preserved).
 */
export function syncSchedulerInclusionKeysFromLegacyBooleans(
  settings: UserSettings
): UserSettings {
  return {
    ...settings,
    schedulerFrameworkInclusion: schedulerFrameworkInclusionSchema.parse({
      ...settings.schedulerFrameworkInclusion,
      wheel: settings.wheel.enabled,
      ppfPillar: settings.ppf.enabled,
      hp6: settings.hpp.enabled
    })
  };
}

/** Call before save when slices like `constraints-section` flipped `wheel` / `ppf` / `hpp.enabled`. */
export function coerceSettingsAfterLegacyWheelPpfHppEdit(settings: UserSettings): UserSettings {
  return syncLegacyFrameworkFlagsFromInclusion(syncSchedulerInclusionKeysFromLegacyBooleans(settings));
}

/** Call before save when Planning Hub patched `schedulerFrameworkInclusion`. */
export function coerceSettingsAfterSchedulerFrameworkInclusionPatch(
  settings: UserSettings
): UserSettings {
  return syncLegacyFrameworkFlagsFromInclusion(settings);
}

/* ─────────────────────────── 14. Personal Perfect Week profile ───────────── */

/**
 * Optional rule cards for energy-aware and transition-aware placement.
 * Only applied when `energyBatterySchedulingEnabled` is true.
 */
export const personalSystemAdvancedRuleSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  label: z.string().max(200).optional(),
  condition: z
    .enum(["after_drain_block", "after_focus_block", "morning_low_battery", "always"])
    .default("always"),
  prefer: z
    .enum(["prefer_hyperfocus_goal", "prefer_recovery_play", "avoid_back_to_back_drain"])
    .default("avoid_back_to_back_drain"),
  priority: z.number().int().min(0).max(100).default(50)
});
export type PersonalSystemAdvancedRule = z.infer<typeof personalSystemAdvancedRuleSchema>;

export const personalSystemGuidedSchema = z.object({
  /**
   * Multiplier on drain-to-drain adjacency penalty in battery mode (1 = default strength).
   */
  drainTransitionPenaltyScale: z.number().min(0).max(3).default(1),
  /**
   * How strongly calendar-heavy days bias placement toward charging / focus-shaped goals (0 disables).
   */
  calendarDrainRecoveryBias: z.number().min(0).max(2).default(1)
});
export type PersonalSystemGuided = z.infer<typeof personalSystemGuidedSchema>;

export const personalSystemSchema = z.object({
  /** Persists “Build your system” UX; allocator only reacts to sub-flags below. */
  enabled: z.boolean().default(false),
  /**
   * When true, allocator adds battery / calendar-aware transition scoring on top of existing rules.
   * When false, scheduling matches historic behavior (no extra scoring).
   */
  energyBatterySchedulingEnabled: z.boolean().default(false),
  guided: personalSystemGuidedSchema.default({} as never),
  advancedRules: z.array(personalSystemAdvancedRuleSchema).default([]),
  profileVersion: positiveInt.default(1),
  updatedAtMs: z.number().int().optional()
});
export type PersonalSystem = z.infer<typeof personalSystemSchema>;

/* ─────────────────── Unified framework registry (Planning + calendar UI) ─── */

export const frameworkRegistryExtraIds = ["consistency", "routines"] as const;
export type FrameworkRegistryExtraId = (typeof frameworkRegistryExtraIds)[number];

export const frameworkRegistryIdSchema = z.enum([
  ...schedulerFrameworkInclusionKeys,
  ...frameworkRegistryExtraIds
]);
export type FrameworkRegistryId = z.infer<typeof frameworkRegistryIdSchema>;

export const frameworkOverlaySchema = z.object({
  enabled: z.boolean().default(true),
  colorToken: z.string().max(32).optional()
});
export type FrameworkOverlay = z.infer<typeof frameworkOverlaySchema>;

export const frameworkRegistryEntrySchema = z.object({
  id: frameworkRegistryIdSchema,
  label: z.string().max(120).optional(),
  enabled: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(99).default(0),
  overlay: frameworkOverlaySchema.default({ enabled: true })
});
export type FrameworkRegistryEntry = z.infer<typeof frameworkRegistryEntrySchema>;

export const methodModuleIdSchema = z.enum(["energy_transitions"]);
export type MethodModuleId = z.infer<typeof methodModuleIdSchema>;

export const methodModuleSchema = z.object({
  id: methodModuleIdSchema,
  enabled: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional()
});
export type MethodModule = z.infer<typeof methodModuleSchema>;

export const frameworkSystemSchema = z.object({
  version: z.number().int().positive().default(1),
  frameworks: z.array(frameworkRegistryEntrySchema).default([]),
  methodModules: z
    .array(methodModuleSchema)
    .default([{ id: "energy_transitions", enabled: false }]),
  placementSignalsOrder: z.array(placementSignalKey).optional()
});
export type FrameworkSystem = z.infer<typeof frameworkSystemSchema>;

export const FRAMEWORK_REGISTRY_DEFAULT_LABELS: Record<FrameworkRegistryId, string> = {
  commitment: "Commitment",
  polarity: "Energy polarity",
  attention: "Attention",
  workLayer: "Work layer",
  wheel: "Wheel of Life",
  ppfPillar: "PPF pillar",
  ppfHorizon: "PPF horizon",
  hp6: "HP6",
  consistency: "Consistency segments",
  routines: "Routines"
};

/** Short onboarding copy for the Planning Hub framework picker (blank-canvas UX). */
export const FRAMEWORK_REGISTRY_DESCRIPTIONS: Record<FrameworkRegistryId, string> = {
  commitment:
    "Non-negotiable vs nice-to-have tiers so true priorities reserve time before everything else.",
  polarity:
    "Energising vs draining goals so draining work is spaced and recovery can cluster.",
  attention:
    "Deep hyper-focus vs reactive hyper-awareness so gaps match cognitive mode.",
  workLayer:
    "Needle-moving vs ops vs play so the allocator can balance workload shape.",
  wheel:
    "Life-area tags with optional weekly minimums from scheduling outcomes.",
  ppfPillar:
    "Personal / professional / financial mix and touch targets when PPF rules are enabled.",
  ppfHorizon:
    "1y / 3y / 5y horizon tagging that pairs with PPF scheduling rules.",
  hp6:
    "Brendon Burchard’s six habits — pairs with habit minimum touches in scheduling outcomes.",
  consistency:
    "Mirrors whether consistency scheduling is on — calendar overlay only.",
  routines:
    "Mirrors morning / shutdown routines in your timemap — calendar overlay only."
};

const INCLUSION_KEY_BY_REGISTRY_ID: Partial<
  Record<FrameworkRegistryId, SchedulerFrameworkInclusionKey>
> = {
  commitment: "commitment",
  polarity: "polarity",
  attention: "attention",
  workLayer: "workLayer",
  wheel: "wheel",
  ppfPillar: "ppfPillar",
  ppfHorizon: "ppfHorizon",
  hp6: "hp6"
};

const FRAMEWORK_REGISTRY_DEFAULT_SORT: Record<FrameworkRegistryId, number> = {
  commitment: 0,
  polarity: 1,
  attention: 2,
  workLayer: 3,
  wheel: 4,
  ppfPillar: 5,
  ppfHorizon: 6,
  hp6: 7,
  consistency: 8,
  routines: 9
};

/** Full registry IDs in deterministic order (matches `frameworkRegistryIdSchema`). */
const FRAMEWORK_IDS_ALL = [
  ...schedulerFrameworkInclusionKeys,
  ...frameworkRegistryExtraIds
] as const satisfies readonly FrameworkRegistryId[];

const PLACEMENT_SIGNAL_KEYS_ALL: PlacementSignalKey[] = [
  "energyMode",
  "attentionMode",
  "workLayer",
  "energyPolarity"
];

function placementSignalsOrderComplete(order: readonly string[]): boolean {
  if (order.length !== PLACEMENT_SIGNAL_KEYS_ALL.length) return false;
  const set = new Set(order);
  return PLACEMENT_SIGNAL_KEYS_ALL.every((k) => set.has(k));
}

export function defaultFrameworkRegistryFromInclusion(
  inclusion: SchedulerFrameworkInclusion
): FrameworkRegistryEntry[] {
  const keys = FRAMEWORK_IDS_ALL.filter((id) => id !== "consistency" && id !== "routines");
  return keys.map((id) => ({
    id,
    enabled: inclusion[INCLUSION_KEY_BY_REGISTRY_ID[id]!] ?? false,
    sortOrder: FRAMEWORK_REGISTRY_DEFAULT_SORT[id],
    overlay: { enabled: true }
  }));
}

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
  /**
   * Placement-signal priority — when a goal's framework tags imply different
   * ideal hours, this rank decides which signal wins.
   */
  placementPriority: placementPrioritySettingsSchema.default({} as never),
  /**
   * Optional long-horizon vision text used by the planning hub. Persists
   * across weeks; not consumed by the allocator.
   */
  vision: visionSettingsSchema.default({} as never),
  allocator: allocatorSettingsSchema.default({} as never),
  travelCache: travelCacheSchema.default({} as never),
  /** Which Planning Hub framework dimensions participate in allocator behavior. */
  schedulerFrameworkInclusion: schedulerFrameworkInclusionSchema.default({} as never),
  /**
   * Personal “perfect week” profile: guided knobs + optional rule cards.
   * Additive; allocator uses only when `energyBatterySchedulingEnabled` is true.
   */
  personalSystem: personalSystemSchema.default({} as never),
  /**
   * Unified registry mirrors scheduler inclusion plus optional calendar/UI metadata.
   * Hydrated from canonical fields on load; callers that edit registry toggles must
   * run `applyCanonicalFromFrameworkSystem` before save — see hydrate helper below.
   */
  frameworkSystem: frameworkSystemSchema.default({} as never)
});
export type UserSettings = z.infer<typeof userSettingsSchema>;

/**
 * When turning allocator inclusion off for a registry-backed framework row, disable its
 * Perfect Week overlay too (avoids “Cal on but scheduler off” after reconcile hydrate).
 */
export function applyFrameworkOverlayOffForSchedulerPatch(
  settings: UserSettings,
  inclusionPatch: Partial<SchedulerFrameworkInclusion>
): UserSettings {
  const patchKeys = schedulerFrameworkInclusionKeys.filter((k) => inclusionPatch[k] === false);
  if (patchKeys.length === 0) return settings;

  const fs = frameworkSystemSchema.parse(settings.frameworkSystem ?? {});
  const disabledIds = new Set(
    FRAMEWORK_IDS_ALL.filter((fid) => {
      const rk = INCLUSION_KEY_BY_REGISTRY_ID[fid];
      return rk != null && patchKeys.includes(rk);
    })
  );

  let changed = false;
  const frameworks = fs.frameworks.map((row) => {
    if (!disabledIds.has(row.id)) return row;
    const cur = row.overlay ?? { enabled: true };
    if (cur.enabled === false) return row;
    changed = true;
    return { ...row, overlay: { ...cur, enabled: false } };
  });
  return changed ? { ...settings, frameworkSystem: { ...fs, frameworks } } : settings;
}

/**
 * Hydrate `frameworkSystem` from canonical allocator fields (inclusion, energy module,
 * placement, consistency/routines). Safe on every load/save — call after merges.
 */
export function reconcileFrameworkSystemFromCanonical(settings: UserSettings): UserSettings {
  const inc = settings.schedulerFrameworkInclusion;
  let frameworks = [...(settings.frameworkSystem?.frameworks ?? [])];

  if (frameworks.length === 0) {
    frameworks = defaultFrameworkRegistryFromInclusion(inc);
  }

  const byId = new Map(frameworks.map((r) => [r.id, { ...r }] as const));

  for (const id of FRAMEWORK_IDS_ALL) {
    if (id === "consistency" || id === "routines") continue;
    const incKey = INCLUSION_KEY_BY_REGISTRY_ID[id];
    if (!incKey) continue;
    const existing = byId.get(id);
    const enabled = inc[incKey];
    if (!existing) {
      byId.set(id, {
        id,
        label: FRAMEWORK_REGISTRY_DEFAULT_LABELS[id],
        enabled,
        sortOrder: FRAMEWORK_REGISTRY_DEFAULT_SORT[id],
        overlay: { enabled: true }
      });
    } else {
      byId.set(id, {
        ...existing,
        enabled,
        label: existing.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS[id],
        sortOrder: existing.sortOrder ?? FRAMEWORK_REGISTRY_DEFAULT_SORT[id]
      });
    }
  }

  const consistencyEnabled = settings.consistency.enabled === true;
  const routinesEnabled =
    settings.timemap.morningRoutine.enabled === true ||
    settings.timemap.shutdownRoutine.enabled === true;

  if (!byId.has("consistency")) {
    byId.set("consistency", {
      id: "consistency",
      label: FRAMEWORK_REGISTRY_DEFAULT_LABELS.consistency,
      enabled: consistencyEnabled,
      sortOrder: FRAMEWORK_REGISTRY_DEFAULT_SORT.consistency,
      overlay: { enabled: true }
    });
  } else {
    const row = byId.get("consistency")!;
    byId.set("consistency", {
      ...row,
      enabled: consistencyEnabled,
      label: row.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS.consistency
    });
  }

  if (!byId.has("routines")) {
    byId.set("routines", {
      id: "routines",
      label: FRAMEWORK_REGISTRY_DEFAULT_LABELS.routines,
      enabled: routinesEnabled,
      sortOrder: FRAMEWORK_REGISTRY_DEFAULT_SORT.routines,
      overlay: { enabled: true }
    });
  } else {
    const row = byId.get("routines")!;
    byId.set("routines", {
      ...row,
      enabled: routinesEnabled,
      label: row.label ?? FRAMEWORK_REGISTRY_DEFAULT_LABELS.routines
    });
  }

  frameworks = FRAMEWORK_IDS_ALL.map((id) => byId.get(id)!).sort(
    (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
  );

  const energyTransitionsEnabled = settings.personalSystem.energyBatterySchedulingEnabled === true;
  const methodModules: MethodModule[] = [...(settings.frameworkSystem?.methodModules ?? [])];
  const mmIdx = methodModules.findIndex((m) => m.id === "energy_transitions");
  if (mmIdx < 0) {
    methodModules.push({ id: "energy_transitions", enabled: energyTransitionsEnabled });
  } else {
    methodModules[mmIdx] = { ...methodModules[mmIdx]!, enabled: energyTransitionsEnabled };
  }

  let placementSignalsOrder = settings.frameworkSystem?.placementSignalsOrder;
  const rootOrder = settings.placementPriority.order;
  if (!placementSignalsOrder || !placementSignalsOrderComplete(placementSignalsOrder)) {
    placementSignalsOrder = [...rootOrder];
  }

  const frameworkSystem = frameworkSystemSchema.parse({
    version: settings.frameworkSystem?.version ?? 1,
    frameworks,
    methodModules,
    placementSignalsOrder
  });

  return { ...settings, frameworkSystem };
}

/**
 * Push registry toggles into canonical allocator fields — call before `saveSettings`
 * when edits originated from framework registry UI.
 */
export function applyCanonicalFromFrameworkSystem(settings: UserSettings): UserSettings {
  const fsRow = frameworkSystemSchema.parse(settings.frameworkSystem ?? {});
  const inc = { ...settings.schedulerFrameworkInclusion };

  for (const row of fsRow.frameworks) {
    const incKey = INCLUSION_KEY_BY_REGISTRY_ID[row.id];
    if (incKey) (inc as Record<string, boolean>)[incKey] = row.enabled;
  }

  const parsedInc = schedulerFrameworkInclusionSchema.parse(inc);

  const energyModule = fsRow.methodModules.find((m) => m.id === "energy_transitions");
  const energyBatterySchedulingEnabled =
    energyModule !== undefined
      ? energyModule.enabled
      : settings.personalSystem.energyBatterySchedulingEnabled;

  let placementPriority = settings.placementPriority;
  if (
    fsRow.placementSignalsOrder &&
    placementSignalsOrderComplete(fsRow.placementSignalsOrder as string[])
  ) {
    placementPriority = { order: [...fsRow.placementSignalsOrder] };
  }

  const nextBase: UserSettings = {
    ...settings,
    schedulerFrameworkInclusion: parsedInc,
    personalSystem: {
      ...settings.personalSystem,
      energyBatterySchedulingEnabled
    },
    placementPriority,
    frameworkSystem: fsRow
  };
  return syncLegacyFrameworkFlagsFromInclusion(nextBase);
}

/** Load/save hydrate — keeps registry overlays in sync with canonical planning state. */
export function hydrateFrameworkSystemMirrors(settings: UserSettings): UserSettings {
  return reconcileFrameworkSystemFromCanonical(settings);
}

/**
 * Settings snapshot for allocator: canonical fields refreshed from hydration,
 * optionally after registry-authored edits (caller should applyCanonical first).
 */
export function resolveSettingsForAllocation(settings: UserSettings): UserSettings {
  return hydrateFrameworkSystemMirrors(settings);
}

/* ───────────────── Migration helper (forward-compatible) ─────────────────── */

function coerceSchedulerFrameworkInclusionForParse(raw: Record<string, unknown>): void {
  const legacyDefault = defaultSchedulerFrameworkInclusionFromLegacy({
    wheel: raw.wheel as { enabled?: boolean } | undefined,
    ppf: raw.ppf as { enabled?: boolean } | undefined,
    hpp: raw.hpp as { enabled?: boolean } | undefined
  });
  const existing = raw.schedulerFrameworkInclusion;
  if (!existing || typeof existing !== "object") {
    raw.schedulerFrameworkInclusion = legacyDefault;
  } else {
    raw.schedulerFrameworkInclusion = schedulerFrameworkInclusionSchema.parse({
      ...legacyDefault,
      ...(existing as object)
    });
  }
}

/**
 * Given a possibly-untyped settings JSON pulled from the database, parse it through
 * the current schema. Older versions can be upgraded here as new versions land.
 */
export function migrateSettings(raw: unknown): UserSettings {
  const coerced: Record<string, unknown> =
    raw && typeof raw === "object"
      ? { ...(raw as object) }
      : {};
  coerceSchedulerFrameworkInclusionForParse(coerced);
  let parsed = userSettingsSchema.parse({
    ...coerced,
    schemaVersion: SETTINGS_SCHEMA_VERSION
  });
  parsed.calendars.sources = parsed.calendars.sources.map((source) => normaliseCalendarSource(source));
  parsed = syncLegacyFrameworkFlagsFromInclusion(parsed);
  parsed = hydrateFrameworkSystemMirrors(parsed);
  return parsed;
}
