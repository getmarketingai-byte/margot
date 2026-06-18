import {
  pgTable,
  text,
  timestamp,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const postStatusEnum = pgEnum("post_status", [
  "draft",
  "scheduled",
  "published",
  "failed",
  "archived",
]);

export const postPlatformEnum = pgEnum("post_platform", [
  "twitter",
  "linkedin",
  "email",
  "instagram",
  "facebook",
  "newsletter",
  "blog",
]);

export const posts = pgTable("posts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  platform: postPlatformEnum("platform").notNull(),
  status: postStatusEnum("status").notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { mode: "date" }),
  publishedAt: timestamp("published_at", { mode: "date" }),
  /**
   * Flexible metadata field for platform-specific data.
   * e.g. { tweetId, linkedinUrn, emailSubject, previewImageUrl }
   */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const postsRelations = relations(posts, ({ one }) => ({
  user: one(users, { fields: [posts.userId], references: [users.id] }),
}));

export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type PostStatus = (typeof postStatusEnum.enumValues)[number];
export type PostPlatform = (typeof postPlatformEnum.enumValues)[number];
