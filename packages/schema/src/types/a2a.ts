/**
 * A2A (Agent-to-Agent) protocol types for Margot.
 * Runtime implementation deferred until Gemini API key arrives (NMA-1470).
 * These are TypeScript types only — no runtime code.
 */

export type AgentCapabilityKind =
  | "generate_content"
  | "analyze_data"
  | "search_web"
  | "send_email"
  | "schedule_post"
  | "read_contacts"
  | "write_contacts";

export interface AgentCapability {
  kind: AgentCapabilityKind;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type AgentMessageRole = "user" | "agent" | "system";

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  agentId?: string;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export type AgentRunStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface AgentRun {
  id: string;
  agentId: string;
  userId: string;
  status: AgentRunStatus;
  messages: AgentMessage[];
  tools?: AgentTool[];
  inputData?: unknown;
  outputData?: unknown;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  tools: AgentTool[];
  modelId?: string; // e.g. "gemini-2.0-flash"
}
