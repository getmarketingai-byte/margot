import {
  pgTable,
  text,
  timestamp,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const creditOperationEnum = pgEnum("credit_operation", [
  "credit",   // tokens added (purchase, free tier, refund)
  "debit",    // tokens consumed (AI generation, embedding, etc.)
]);

export const creditResourceTypeEnum = pgEnum("credit_resource_type", [
  "post_generation",
  "signal_embedding",
  "agent_run",
  "prompt_execution",
  "image_generation",
  "plan_purchase",
  "referral_bonus",
  "admin_adjustment",
]);

export const creditLedger = pgTable("credit_ledger", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Signed integer: positive for credits, negative for debits.
   * Stored in micro-credits (1 credit = 1_000_000 micro-credits)
   * to avoid floating-point issues.
   */
  amount: integer("amount").notNull(),
  operation: creditOperationEnum("operation").notNull(),
  /**
   * The resource that triggered this ledger entry, e.g. a post ID or agent_run ID.
   */
  resourceId: text("resource_id"),
  resourceType: creditResourceTypeEnum("resource_type"),
  /**
   * Running balance at the time this entry was written.
   * Denormalised for fast balance lookups (avoids SUM across all rows).
   */
  balance: integer("balance").notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  user: one(users, { fields: [creditLedger.userId], references: [users.id] }),
}));

export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type NewCreditLedgerEntry = typeof creditLedger.$inferInsert;
export type CreditOperation = (typeof creditOperationEnum.enumValues)[number];
export type CreditResourceType = (typeof creditResourceTypeEnum.enumValues)[number];
