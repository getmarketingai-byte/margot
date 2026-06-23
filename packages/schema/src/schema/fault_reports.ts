import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export type FaultReportType = "404" | "500" | "client_error" | "api_error" | "unknown";
export const FAULT_REPORT_TYPES: FaultReportType[] = ["404", "500", "client_error", "api_error", "unknown"];

export type FaultReportStatus = "open" | "investigating" | "resolved" | "wont_fix";
export const FAULT_REPORT_STATUSES: FaultReportStatus[] = ["open", "investigating", "resolved", "wont_fix"];

export const faultReports = pgTable("fault_reports", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  /** Optional: the user who experienced the fault (null for unauthenticated users) */
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  /** Fault type category */
  type: text("type").notNull().default("unknown"),
  /** HTTP status code if applicable */
  statusCode: integer("status_code"),
  /** The URL path where the fault occurred */
  path: text("path").notNull(),
  /** Error message */
  message: text("message").notNull(),
  /** Stack trace if available */
  stack: text("stack"),
  /** Browser user agent */
  userAgent: text("user_agent"),
  /** Additional structured context (component name, props, etc.) */
  metadata: jsonb("metadata"),
  /** Investigation/triage status */
  status: text("status").notNull().default("open"),
  /** Admin notes for investigation */
  notes: text("notes"),
  resolvedAt: timestamp("resolved_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "date" }).notNull().defaultNow(),
});

export const faultReportsRelations = relations(faultReports, ({ one }) => ({
  user: one(users, { fields: [faultReports.userId], references: [users.id] }),
}));

export type FaultReport = typeof faultReports.$inferSelect;
export type NewFaultReport = typeof faultReports.$inferInsert;
