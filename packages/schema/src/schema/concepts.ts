import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const concepts = pgTable("concepts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  /**
   * Free-form tags for categorisation and semantic search.
   * Stored as a Postgres text array.
   */
  tags: text("tags").array().notNull().default([]),
  /**
   * Optional parent concept for hierarchical structures (e.g. pillar → cluster).
   */
  parentId: text("parent_id"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const conceptsRelations = relations(concepts, ({ one, many }) => ({
  user: one(users, { fields: [concepts.userId], references: [users.id] }),
  parent: one(concepts, {
    fields: [concepts.parentId],
    references: [concepts.id],
    relationName: "concept_children",
  }),
  children: many(concepts, { relationName: "concept_children" }),
}));

export type Concept = typeof concepts.$inferSelect;
export type NewConcept = typeof concepts.$inferInsert;
