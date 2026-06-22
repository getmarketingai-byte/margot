/**
 * Drizzle schema for the margot app.
 *
 * Includes Auth.js tables (`users`, `accounts`, `sessions`, `verificationTokens`)
 * plus app domain tables: per-user settings, weekly plans/goals, generated
 * snapshots, ICS feed tokens, calendar source links, Google busy cache, weather forecast cache,
 * sleep/routine derivation cache, jobs lock, and Stripe subscriptions.
 *
 * Margot domain tables (P0-2): posts, concepts, signals, contacts,
 * agent_runs, prompts, credit_ledger.
 */

import {
  boolean,
  integer,
  jsonb,
  numeric,
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

/* ───────────────────── Margot domain tables (P0-2) ──────────────────────── */

/**
 * posts — content pipeline.
 * Stores drafted, scheduled, and published marketing content.
 */
export const posts = pgTable("post", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  status: text("status")
    .$type<"draft" | "scheduled" | "published" | "archived">()
    .notNull()
    .default("draft"),
  platform: text("platform"),
  scheduledAt: timestamp("scheduledAt", { mode: "date" }),
  publishedAt: timestamp("publishedAt", { mode: "date" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

/**
 * concepts — brainstorm / idea tree.
 * Raw marketing ideas and campaign concepts, hierarchically linked.
 */
export const concepts = pgTable("concept", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  parentId: text("parentId"),
  title: text("title").notNull(),
  description: text("description"),
  tags: jsonb("tags"),
  status: text("status")
    .$type<"raw" | "refined" | "approved" | "rejected">()
    .notNull()
    .default("raw"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

/**
 * signals — market intelligence.
 * Incoming signals from competitors, trends, customer feedback.
 */
export const signals = pgTable("signal", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source").notNull(),
  kind: text("kind")
    .$type<"competitor" | "trend" | "feedback" | "news" | "other">()
    .notNull()
    .default("other"),
  title: text("title").notNull(),
  url: text("url"),
  summary: text("summary"),
  metadata: jsonb("metadata"),
  capturedAt: timestamp("capturedAt", { mode: "date" }).defaultNow().notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
});

/**
 * contacts — CRM.
 * Leads, clients, and partners in the marketing pipeline.
 */
export const contacts = pgTable("contact", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  role: text("role"),
  stage: text("stage")
    .$type<"lead" | "prospect" | "customer" | "churned">()
    .notNull()
    .default("lead"),
  source: text("source"),
  tags: jsonb("tags"),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

/**
 * agent_runs — agent orchestration log.
 * Records every AI agent invocation for audit and replay.
 */
export const agentRuns = pgTable("agent_run", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentName: text("agentName").notNull(),
  triggerKind: text("triggerKind")
    .$type<"manual" | "scheduled" | "event" | "a2a">()
    .notNull()
    .default("manual"),
  status: text("status")
    .$type<"running" | "success" | "failed" | "cancelled">()
    .notNull()
    .default("running"),
  input: jsonb("input"),
  output: jsonb("output"),
  errorMessage: text("errorMessage"),
  durationMs: integer("durationMs"),
  creditsUsed: integer("creditsUsed").default(0),
  startedAt: timestamp("startedAt", { mode: "date" }).defaultNow().notNull(),
  completedAt: timestamp("completedAt", { mode: "date" })
});

/**
 * prompts — prompt library.
 * Reusable, versioned prompt templates for AI agents.
 */
export const prompts = pgTable("prompt", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  template: text("template").notNull(),
  variables: jsonb("variables"),
  agentName: text("agentName"),
  version: integer("version").notNull().default(1),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).defaultNow().notNull()
});

/**
 * credit_ledger — usage tracking.
 * Debit/credit entries for AI credit consumption per user.
 */
export const creditLedger = pgTable("credit_ledger", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind")
    .$type<"grant" | "debit" | "refund" | "expiry">()
    .notNull(),
  amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
  balance: numeric("balance", { precision: 12, scale: 4 }).notNull(),
  description: text("description"),
  agentRunId: text("agentRunId").references(() => agentRuns.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
});
