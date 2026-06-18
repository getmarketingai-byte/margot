import {
  pgTable,
  text,
  timestamp,
  customType,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

/**
 * pgvector column type for 1536-dimensional embeddings (OpenAI text-embedding-3-small).
 * Requires the pgvector extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config?: { dimensions?: number }) {
    const dims = config?.dimensions ?? 1536;
    return `vector(${dims})`;
  },
  fromDriver(value: string): number[] {
    // pgvector returns values like "[0.1,0.2,...]"
    return JSON.parse(value) as number[];
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

export const signals = pgTable("signals", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Where the signal came from: "rss", "twitter", "reddit", "news", "manual", etc.
   */
  source: text("source").notNull(),
  headline: text("headline").notNull(),
  url: text("url"),
  summary: text("summary"),
  /**
   * 1536-dimensional embedding for semantic similarity search.
   * Populated by the signal-capture Inngest function.
   */
  embedding: vector("embedding", { dimensions: 1536 }),
  capturedAt: timestamp("captured_at", { mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const signalsRelations = relations(signals, ({ one }) => ({
  user: one(users, { fields: [signals.userId], references: [users.id] }),
}));

export type Signal = typeof signals.$inferSelect;
export type NewSignal = typeof signals.$inferInsert;
