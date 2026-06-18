import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const brainDumps = pgTable("brain_dumps", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  /**
   * Optional tags for categorisation.
   */
  tags: text("tags").array().notNull().default([]),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const brainDumpsRelations = relations(brainDumps, ({ one }) => ({
  user: one(users, { fields: [brainDumps.userId], references: [users.id] }),
}));

export type BrainDump = typeof brainDumps.$inferSelect;
export type NewBrainDump = typeof brainDumps.$inferInsert;
