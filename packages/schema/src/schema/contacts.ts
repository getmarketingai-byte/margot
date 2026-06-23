import {
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export type ContactStage = "lead" | "prospect" | "customer" | "churned";
export const CONTACT_STAGES: ContactStage[] = ["lead", "prospect", "customer", "churned"];

export const contacts = pgTable("contacts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  /** Social handle or alternative contact (e.g. @username, LinkedIn URL) */
  handle: text("handle"),
  company: text("company"),
  /** Pipeline stage: lead | prospect | customer | churned */
  stage: text("stage").notNull().default("lead"),
  /** How this contact was sourced (e.g. "linkedin", "referral", "event") */
  source: text("source"),
  tags: text("tags").array().notNull().default([]),
  notes: text("notes"),
  lastContactedAt: timestamp("last_contacted_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export type InteractionType = "email" | "call" | "meeting" | "social";
export const INTERACTION_TYPES: InteractionType[] = ["email", "call", "meeting", "social"];

export const contactInteractions = pgTable("contact_interactions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contactId: text("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  /** Type of interaction: email | call | meeting | social */
  type: text("type").notNull().default("email"),
  body: text("body").notNull().default(""),
  date: timestamp("date", { mode: "date" }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  user: one(users, { fields: [contacts.userId], references: [users.id] }),
  interactions: many(contactInteractions),
}));

export const contactInteractionsRelations = relations(contactInteractions, ({ one }) => ({
  user: one(users, { fields: [contactInteractions.userId], references: [users.id] }),
  contact: one(contacts, { fields: [contactInteractions.contactId], references: [contacts.id] }),
}));

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ContactInteraction = typeof contactInteractions.$inferSelect;
export type NewContactInteraction = typeof contactInteractions.$inferInsert;
