import {
  pgTable,
  text,
  timestamp,
  integer,
  uuid,
  jsonb,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── Auth.js v5 tables (required by @auth/drizzle-adapter) ─────────────────

export const users = pgTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ]
);

export const sessions = pgTable("session", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ─── Margot domain tables ────────────────────────────────────────────────────

export const posts = pgTable("post", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body"),
  status: text("status").notNull().default("draft"), // draft | scheduled | published
  channel: text("channel"), // linkedin | twitter | email | blog
  scheduledAt: timestamp("scheduled_at", { mode: "date" }),
  publishedAt: timestamp("published_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const concepts = pgTable("concept", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  title: text("title").notNull(),
  body: text("body"),
  tags: text("tags").array(),
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const signals = pgTable("signal", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source"), // rss | manual | google-alerts
  title: text("title").notNull(),
  content: text("content"),
  url: text("url"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const contacts = pgTable("contact", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email"),
  company: text("company"),
  role: text("role"),
  notes: text("notes"),
  status: text("status").notNull().default("lead"), // lead | prospect | client | churned
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const agentRuns = pgTable("agent_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentName: text("agent_name").notNull(),
  status: text("status").notNull().default("pending"), // pending | running | done | failed
  inputData: jsonb("input_data"),
  outputData: jsonb("output_data"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { mode: "date" }),
  completedAt: timestamp("completed_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const prompts = pgTable("prompt", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  tags: text("tags").array(),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).default(sql`now()`).notNull(),
});

export const creditLedger = pgTable("credit_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(), // positive = credit, negative = debit
  description: text("description").notNull(),
  referenceId: text("reference_id"), // agent_run_id or other reference
  createdAt: timestamp("created_at", { mode: "date" }).default(sql`now()`).notNull(),
});
