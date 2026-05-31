/**
 * A2A (Agent-to-Agent) protocol interface definitions for Margot.
 * Runtime wiring deferred until Gemini API key is provisioned.
 * @see NMA-1472 P0-7
 */

/** Supported Margot agent names */
export type MargotAgentName =
  | "content-strategist"
  | "social-scheduler"
  | "email-copywriter"
  | "seo-analyst"
  | "lead-qualifier"
  | "campaign-manager"
  | "analytics-reporter"
  | "brand-guardian";

/** Base message envelope for A2A communication */
export interface A2AMessage {
  id: string;
  from: MargotAgentName | "orchestrator";
  to: MargotAgentName | "orchestrator";
  timestamp: string;
  correlationId?: string;
  payload: A2APayload;
}

export interface A2APayload {
  type: A2APayloadType;
  data: Record<string, unknown>;
}

export type A2APayloadType =
  | "task_request"
  | "task_result"
  | "task_error"
  | "context_update"
  | "approval_request"
  | "approval_response";

/** Task request from orchestrator to agent */
export interface A2ATaskRequest extends A2APayload {
  type: "task_request";
  data: {
    task: string;
    context: MarketingContext;
    constraints?: Record<string, unknown>;
  };
}

/** Result returned by an agent */
export interface A2ATaskResult extends A2APayload {
  type: "task_result";
  data: {
    result: unknown;
    confidence?: number;
    reasoning?: string;
  };
}

/** Marketing context passed between agents */
export interface MarketingContext {
  userId: string;
  businessName: string;
  industry?: string;
  targetAudience?: string;
  goals?: string[];
  locale: "en-AU";
  currentCampaign?: string;
}

/** Agent capability declaration */
export interface AgentCapability {
  agent: MargotAgentName;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  rateLimit?: { requestsPerMinute: number };
}

/** A2A contract: the interface every Margot agent must implement */
export interface MargotAgent {
  name: MargotAgentName;
  capabilities: AgentCapability[];
  handle(message: A2AMessage): Promise<A2AMessage>;
}

/** Registry of all Margot agents (populated at runtime) */
export type AgentRegistry = Map<MargotAgentName, MargotAgent>;
