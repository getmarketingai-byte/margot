import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export type SignalSourceType = "competitor" | "trend" | "feedback" | "news" | "manual";
export const SIGNAL_SOURCE_TYPES: SignalSourceType[] = ["competitor", "trend", "feedback", "news", "manual"];

export const signals = pgTable("signals", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Source type: competitor | trend | feedback | news | manual
   */
  source: text("source").notNull(),
  headline: text("headline").notNull(),
  url: text("url"),
  summary: text("summary"),
  capturedAt: timestamp("captured_at", { mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const signalsRelations = relations(signals, ({ one }) => ({
  user: one(users, { fields: [signals.userId], references: [users.id] }),
}));

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
