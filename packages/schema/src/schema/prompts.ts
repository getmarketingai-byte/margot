import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const prompts = pgTable("prompts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Machine-readable key used to look up prompts in code,
   * e.g. "linkedin-hook-writer", "signal-summariser".
   */
  key: text("key").notNull(),
  title: text("title").notNull(),
  /**
   * Prompt body with optional Handlebars-style variable placeholders,
   * e.g. "Write a LinkedIn hook about {{topic}} for {{audience}}".
   */
  body: text("body").notNull(),
  /**
   * Variable names extracted from the body, e.g. ["topic", "audience"].
   */
  variables: text("variables").array().notNull().default([]),
  /**
   * Grouping category, e.g. "content", "outreach", "research", "system".
   */
  category: text("category").notNull().default("content"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const promptsRelations = relations(prompts, ({ one }) => ({
  user: one(users, { fields: [prompts.userId], references: [users.id] }),
}));

export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
