import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const agentRuns = pgTable("agent_runs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * Stable machine-readable identifier for the agent type,
   * e.g. "signal-capture", "content-repurposer", "outreach-sequencer".
   */
  agentId: text("agent_id").notNull(),
  /**
   * Human-readable display name for the agent.
   */
  agentName: text("agent_name").notNull(),
  /**
   * JSON payload that was sent to the agent on start.
   */
  inputJson: jsonb("input_json").$type<Record<string, unknown>>(),
  /**
   * JSON payload returned by the agent on completion.
   * null while the run is still pending/running.
   */
  outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
  status: agentRunStatusEnum("status").notNull().default("pending"),
  /**
   * Wall-clock duration in milliseconds. Populated on completion.
   */
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

export const agentRunsRelations = relations(agentRuns, ({ one }) => ({
  user: one(users, { fields: [agentRuns.userId], references: [users.id] }),
}));

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentRunStatus = (typeof agentRunStatusEnum.enumValues)[number];
