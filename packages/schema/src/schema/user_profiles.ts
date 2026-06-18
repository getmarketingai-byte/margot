import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const userProfiles = pgTable("user_profiles", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Business / professional headline, e.g. "Founder @ Acme"
   */
  headline: text("headline"),
  bio: text("bio"),
  /**
   * Primary industry / niche for content targeting.
   */
  industry: text("industry"),
  /**
   * Target audience description.
   */
  targetAudience: text("target_audience"),
  /**
   * Business website URL.
   */
  website: text("website"),
  /**
   * LinkedIn profile URL.
   */
  linkedinUrl: text("linkedin_url"),
  /**
   * Twitter / X handle (without @).
   */
  twitterHandle: text("twitter_handle"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
