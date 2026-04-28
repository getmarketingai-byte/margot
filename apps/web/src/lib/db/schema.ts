/**
 * Drizzle schema for the calendar-automations app.
 *
 * Includes Auth.js tables (`users`, `accounts`, `sessions`, `verificationTokens`)
 * plus app domain tables: per-user settings, weekly plans/goals, generated
 * snapshots, ICS feed tokens, calendar source links, jobs lock, and Stripe
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

export const feedTokens = pgTable(
  "feed_token",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    feed: text("feed").notNull().$type<"timemap" | "sleep" | "travel" | "weekly" | "all">(),
    name: text("name").notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("createdAt", { mode: "date" }).defaultNow().notNull()
  },
  (table) => ({
    perUserFeed: uniqueIndex("feed_token_user_feed").on(table.userId, table.feed)
  })
);

export const jobLocks = pgTable("job_lock", {
  key: text("key").primaryKey(),
  userId: text("userId").notNull(),
  acquiredAt: timestamp("acquiredAt", { mode: "date" }).defaultNow().notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull()
});
