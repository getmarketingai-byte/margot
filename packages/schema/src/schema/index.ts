/**
 * Barrel export for all Drizzle table definitions.
 * Import individual tables or use the wildcard in drizzle.config.ts.
 */

export * from "./auth";
export * from "./posts";
export * from "./concepts";
export * from "./signals";
export * from "./contacts";
export * from "./agent_runs";
export * from "./prompts";
export * from "./credit_ledger";
export * from "./brain_dumps";
export * from "./user_profiles";

// A2A protocol types (NOT tables – TypeScript only)
// Re-export with A2A prefix to avoid collision with agent_runs DB types
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  AgentToolParameter,
  AgentTool,
  AgentRunStatus as A2AAgentRunStatus,
  AgentRun as A2AAgentRun,
} from "./a2a";
export type * from "./a2a";
