/**
 * Drizzle schema for the calendar-automations app.
 *
 * Includes Auth.js tables (`users`, `accounts`, `sessions`, `verificationTokens`)
 * plus app domain tables: per-user settings, weekly plans/goals, generated
 * snapshots, ICS feed tokens, calendar source links, Google busy cache, weather forecast cache,
 * sleep/routine derivation cache, jobs lock, and Stripe
 * subscriptions.
 */

import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

/* ─────────────── Auth.js core tables (Drizzle adapter shape) ─────────────── */

export const users = pgTable("user", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  stripeCustomerId: text("stripeCustomerId"),
  subscriptionStatus: text("subscriptionStatus")
    .$type<
      "none" | "trialing" | "active" | "past_due" | "canceled" | "unpaid"
    >()
    .default("none"),
  subscriptionId: text("subscriptionId"),
  subscriptionPriceId: text("subscriptionPriceId"),
  subscriptionPeriodEnd: timestamp("subscriptionPeriodEnd", { mode: "date" }),
  // App-side 7-day no-card trial. Set on user creation; checked by the feed
  // gate even when `subscriptionStatus` is still "none".
  trialEndsAt: timestamp("trialEndsAt", { mode: "date" }),
  // Operator escape hatch. When true, the paid-feature gate is bypassed
  // regardless of subscription/trial state. Set directly via SQL for trusted
  // accounts (see ensure_uptodate.sql for the canonical update statement).
  paymentGateBypass: boolean("paymentGateBypass").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state")
  },
  (account) => ({
    pk: primaryKey({ columns: [account.provider, account.providerAccountId] })
  })
);

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull()
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull()
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] })
  })
);

/* ────────────────────────────── App tables ───────────────────────────────── */

export const userSettings = pgTable("user_settings", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  schemaVersion: integer("schemaVersion").notNull().default(1),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

export const weeklyPlans = pgTable(
  "weekly_plan",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: text("weekStart").notNull(),
    timezone: text("timezone").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
  },
  (table) => ({
    perUserWeek: uniqueIndex("weekly_plan_user_week").on(table.userId, table.weekStart)
  })
);

export const calendarSnapshots = pgTable("calendar_snapshot", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  generatedAt: timestamp("generatedAt", { mode: "date" }).defaultNow().notNull(),
  windowStartMs: text("windowStartMs").notNull(),
  windowEndMs: text("windowEndMs").notNull(),
  events: jsonb("events").notNull()
});

/** User-built ICS subsets (combined via OR rules against snapshot events). */
export const icsCustomFeeds = pgTable("ics_custom_feed", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  rules: jsonb("rules").notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

/** Latest Google Calendar busy snapshot per user (server-side cache for fast reads). */
export const googleBusyCache = pgTable("google_busy_cache", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  windowStartMs: text("windowStartMs").notNull(),
  windowEndMs: text("windowEndMs").notNull(),
  sourcesFingerprint: text("sourcesFingerprint").notNull(),
  busyEvents: jsonb("busyEvents").notNull(),
  goalAvailabilityWindows: jsonb("goalAvailabilityWindows").notNull()
});

/** Open-Meteo + sunrise API payloads keyed by forecast coordinates (server-side cache). */
export const weatherForecastCache = pgTable("weather_forecast_cache", {
  userId: text("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull(),
  coordsFingerprint: text("coordsFingerprint").notNull(),
  openMeteoJson: jsonb("openMeteoJson"),
  openMeteoFetchedAtMs: text("openMeteoFetchedAtMs").notNull(),
  sunriseByDate: jsonb("sunriseByDate").notNull()
});

/**
 * Cached sleep + morning/shutdown routine blocks per ISO week (Monday date).
 * Invalidated implicitly via inputs fingerprint (calendar busy, travel overlays,
 * sleep window, routine minutes, overrides).
 */
export const systemSleepRoutineCache = pgTable(
  "system_sleep_routine_cache",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStartIso: text("weekStartIso").notNull(),
    inputsFingerprint: text("inputsFingerprint").notNull(),
    sleepBlocks: jsonb("sleepBlocks").notNull(),
    routineBlocks: jsonb("routineBlocks").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.weekStartIso] })
  })
);

export const feedTokens = pgTable("feed_token", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  /** Builtin `all`; `custom` rows require customFeedId. Partial unique indexes in SQL migrations. */
  feed: text("feed").notNull().$type<"all" | "custom">(),
  customFeedId: text("customFeedId").references(() => icsCustomFeeds.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
});

export const jobLocks = pgTable("job_lock", {
  key: text("key").primaryKey(),
  userId: text("userId").notNull(),
  acquiredAt: timestamp("acquiredAt", { mode: "date" }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull()
});

export const dailyReviews = pgTable(
  "daily_review",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    timezone: text("timezone").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
  },
  (table) => ({
    perUserDate: uniqueIndex("daily_review_user_date").on(table.userId, table.date)
  })
);

export const weeklyReviews = pgTable(
  "weekly_review",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    weekStart: text("weekStart").notNull(),
    timezone: text("timezone").notNull(),
    data: jsonb("data").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
  },
  (table) => ({
    perUserWeek: uniqueIndex("weekly_review_user_week").on(table.userId, table.weekStart)
  })
);
