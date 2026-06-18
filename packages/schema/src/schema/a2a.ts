/**
 * Agent-to-Agent (A2A) Protocol TypeScript types.
 *
 * These are pure TypeScript interfaces used for runtime type safety
 * between Margot's AI agents. They are NOT Drizzle database tables.
 *
 * Inspired by Google's A2A specification:
 * https://github.com/google-gemini/a2a-js
 */

// ── Primitives ─────────────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

// ── Tool definitions ──────────────────────────────────────────────────────────

export interface AgentToolParameter {
  name: string;
  description: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  enum?: string[];
  items?: AgentToolParameter;
  properties?: Record<string, AgentToolParameter>;
}

export interface AgentTool {
  /** Unique machine-readable identifier, e.g. "search_signals" */
  name: string;
  /** Human-readable description shown to the orchestrating LLM */
  description: string;
  parameters: AgentToolParameter[];
  /** Whether this tool can be called concurrently */
  concurrent?: boolean;
  /** Maximum execution time in milliseconds */
  timeoutMs?: number;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type AgentMessageRole = "user" | "assistant" | "system" | "tool";

export interface AgentMessageContent {
  type: "text" | "tool_call" | "tool_result" | "image_url";
  text?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: JsonObject;
  toolResult?: JsonValue;
  imageUrl?: string;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: AgentMessageContent | AgentMessageContent[];
  createdAt: Date;
  metadata?: JsonObject;
}

// ── Agent capabilities ────────────────────────────────────────────────────────

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  version: string;
  tools: AgentTool[];
  /** Input schema the agent accepts */
  inputSchema?: JsonObject;
  /** Output schema the agent produces */
  outputSchema?: JsonObject;
  /** Tags for discovery and routing, e.g. ["content", "research"] */
  tags?: string[];
}

// ── Run lifecycle ─────────────────────────────────────────────────────────────

export type AgentRunStatus =
  | "pending"
  | "running"
  | "awaiting_tool"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentRun {
  id: string;
  agentId: string;
  agentName: string;
  userId: string;
  status: AgentRunStatus;
  messages: AgentMessage[];
  input: JsonObject;
  output?: JsonValue;
  error?: string;
  /** Inngest event/function ID for correlation */
  inngestRunId?: string;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  metadata?: JsonObject;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export interface AgentTaskRequest {
  /** Target agent capability ID */
  agentId: string;
  userId: string;
  input: JsonObject;
  /** Priority: 1 = low, 5 = normal, 10 = urgent */
  priority?: number;
  /** ISO 8601 deadline */
  deadline?: string;
  parentRunId?: string;
  metadata?: JsonObject;
}

export interface AgentTaskResponse {
  runId: string;
  status: AgentRunStatus;
  output?: JsonValue;
  error?: string;
}

// ── Events (Inngest-compatible) ───────────────────────────────────────────────

export interface AgentStartedEvent {
  name: "agent/run.started";
  data: Pick<AgentRun, "id" | "agentId" | "agentName" | "userId" | "input">;
}

export interface AgentCompletedEvent {
  name: "agent/run.completed";
  data: Pick<AgentRun, "id" | "agentId" | "userId" | "output" | "durationMs">;
}

export interface AgentFailedEvent {
  name: "agent/run.failed";
  data: Pick<AgentRun, "id" | "agentId" | "userId" | "error">;
}

export type AgentEvent =
  | AgentStartedEvent
  | AgentCompletedEvent
  | AgentFailedEvent;
