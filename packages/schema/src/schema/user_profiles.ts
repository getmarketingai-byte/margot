import {
  pgTable,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

/** A content pillar: one of 3-6 themes the user posts about */
export interface ContentPillar {
  name: string;
  description: string;
}

/** A signal source the user wants Margot to monitor */
export interface SignalSource {
  type: "subreddit" | "rss" | "x_account";
  url: string;
}

export const userProfiles = pgTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),

  // ── Sprint 1 fields (kept for backwards compat) ──────────────────────────
  headline: text("headline"),
  bio: text("bio"),
  industry: text("industry"),
  website: text("website"),
  linkedinUrl: text("linkedin_url"),
  twitterHandle: text("twitter_handle"),

  // ── Sprint 3: Onboarding / Profile fields ────────────────────────────────

  /**
   * Step 1 — Brand Voice
   * Tone description, phrases the user uses, dos and don'ts.
   */
  brandVoice: text("brand_voice"),

  /**
   * Step 2 — Content Pillars (JSON array of {name, description})
   * 3–6 themes the user posts about.
   */
  contentPillars: jsonb("content_pillars").$type<ContentPillar[]>(),

  /**
   * Step 3 — Target Audience
   * Who they reach and what problems those people have.
   */
  targetAudience: text("target_audience"),

  /**
   * Step 4 — Posting Cadence
   */
  postingCadence: text("posting_cadence").$type<
    "daily" | "3x_week" | "weekly" | "custom" | null
  >(),

  /**
   * Step 5 — Signal Sources (JSON array)
   * Subreddit URLs, RSS feeds, X accounts to monitor.
   */
  signalSources: jsonb("signal_sources").$type<SignalSource[]>(),

  /**
   * Step 6 — Sales Model
   */
  salesModel: text("sales_model").$type<
    "subscription" | "deal_pipeline" | null
  >(),

  /**
   * Whether the user has completed the onboarding flow.
   * Set to true when they complete Step 7 (Review & Confirm).
   */
  onboardingComplete: text("onboarding_complete")
    .$type<"true" | null>()
    .default(null),

  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
