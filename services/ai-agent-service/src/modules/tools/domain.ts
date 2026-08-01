/**
 * tools/domain.ts — F.4 governed ReAct tool catalogue + step governance.
 * Pure functions only.
 */

export type AgentDomain = "crm" | "helpdesk" | "finance" | "hrms" | "generic";

export const AGENT_DOMAINS: readonly AgentDomain[] = ["crm", "helpdesk", "finance", "hrms", "generic"];

export type ReactStepStatus = "executed" | "pending_approval" | "rejected";

export function validateAgentDomain(domain: string): string | null {
  if (!AGENT_DOMAINS.includes(domain as AgentDomain)) {
    return `agentDomain must be one of: ${AGENT_DOMAINS.join(", ")}`;
  }
  return null;
}

export interface ToolDefinitionInput {
  toolName?: unknown;
  agentDomain?: unknown;
  inputSchema?: unknown;
}

/** Returns null when the tool definition is well-formed, else an error message. */
export function validateToolDefinition(def: ToolDefinitionInput): string | null {
  if (typeof def.agentDomain !== "string") return "agentDomain is required";
  const domainError = validateAgentDomain(def.agentDomain);
  if (domainError) return domainError;

  if (typeof def.toolName !== "string" || def.toolName.trim().length === 0) {
    return "toolName is required";
  }
  if (def.toolName.length > 120) {
    return "toolName must be at most 120 characters";
  }
  // Tool names end up in model prompts and in the ReAct `action` column; keeping
  // them to a strict identifier shape avoids prompt-delimiter smuggling.
  if (!/^[a-z][a-z0-9_.]*$/.test(def.toolName)) {
    return "toolName must be lower_snake_case (letters, digits, underscore, dot)";
  }
  if (def.inputSchema !== undefined && def.inputSchema !== null) {
    if (typeof def.inputSchema !== "object" || Array.isArray(def.inputSchema)) {
      return "inputSchema must be an object";
    }
  }
  return null;
}

export interface ReactStepDecision {
  executed: boolean;
  status: ReactStepStatus;
  code: "EXECUTED" | "PENDING_APPROVAL" | "TOOL_DISABLED";
  message: string;
}

/**
 * Decide what happens to a ReAct step that wants to use `tool`.
 *
 * THE GOVERNANCE BOUNDARY: a tool marked requires_approval is never executed by
 * the agent. The step is recorded with executed = false and status
 * 'pending_approval' so the reasoning trace is preserved for the approver, but
 * nothing downstream may treat it as done. This is what keeps an autonomous
 * agent from, say, issuing a refund or closing a citizen grievance on its own —
 * the model may propose the action, a human authorises it. Callers MUST NOT
 * override `executed` on the strength of the observation field.
 */
export function decideReactStep(tool: {
  enabled: boolean;
  requiresApproval: boolean;
}): ReactStepDecision {
  if (!tool.enabled) {
    return {
      executed: false,
      status: "rejected",
      code: "TOOL_DISABLED",
      message: "tool is disabled for this tenant",
    };
  }
  if (tool.requiresApproval) {
    return {
      executed: false,
      status: "pending_approval",
      code: "PENDING_APPROVAL",
      message: "tool requires human approval; step recorded but not executed",
    };
  }
  return {
    executed: true,
    status: "executed",
    code: "EXECUTED",
    message: "step executed",
  };
}

export interface DefaultToolTemplate {
  agentDomain: AgentDomain;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  requiresApproval: boolean;
}

/**
 * Default tool sets for the CRM/Sales agent and the Service/ticket agent.
 *
 * These are templates, not migration seed rows: tool_definitions.tenant_id is
 * NOT NULL, so a shared "template tenant" row would either break RLS or leak one
 * tenant's catalogue into every install. Tenants materialise them through
 * POST /v1/ai/tools/seed-defaults instead.
 *
 * requiresApproval is set on anything a citizen or customer would feel: money,
 * outbound communication, and closing someone's ticket.
 */
export const DEFAULT_TOOL_TEMPLATES: readonly DefaultToolTemplate[] = [
  // ── CRM / Sales agent ─────────────────────────────────────────────────────
  {
    agentDomain: "crm",
    toolName: "lookup_customer",
    description: "Fetch a customer profile and recent interaction summary by id.",
    inputSchema: { type: "object", properties: { customerId: { type: "string", format: "uuid" } }, required: ["customerId"] },
    requiresApproval: false,
  },
  {
    agentDomain: "crm",
    toolName: "search_opportunities",
    description: "Search open sales opportunities by owner, stage or value band.",
    inputSchema: { type: "object", properties: { stage: { type: "string" }, ownerId: { type: "string" } } },
    requiresApproval: false,
  },
  {
    agentDomain: "crm",
    toolName: "log_activity",
    description: "Record a call, meeting or note against a customer timeline.",
    inputSchema: { type: "object", properties: { customerId: { type: "string" }, kind: { type: "string" }, summary: { type: "string" } }, required: ["customerId", "kind"] },
    requiresApproval: false,
  },
  {
    agentDomain: "crm",
    toolName: "create_quotation",
    description: "Draft a priced quotation for an opportunity.",
    inputSchema: { type: "object", properties: { opportunityId: { type: "string" }, currency: { type: "string" } }, required: ["opportunityId"] },
    requiresApproval: true,
  },
  {
    agentDomain: "crm",
    toolName: "apply_discount",
    description: "Apply a discount to a quotation line.",
    inputSchema: { type: "object", properties: { quotationId: { type: "string" }, pct: { type: "number" } }, required: ["quotationId", "pct"] },
    requiresApproval: true,
  },
  // ── Service / ticket agent ────────────────────────────────────────────────
  {
    agentDomain: "helpdesk",
    toolName: "lookup_ticket",
    description: "Fetch a ticket with its status, SLA clock and history.",
    inputSchema: { type: "object", properties: { ticketId: { type: "string", format: "uuid" } }, required: ["ticketId"] },
    requiresApproval: false,
  },
  {
    agentDomain: "helpdesk",
    toolName: "search_knowledge",
    description: "Search the knowledge base for resolution articles.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    requiresApproval: false,
  },
  {
    agentDomain: "helpdesk",
    toolName: "add_ticket_note",
    description: "Append an internal note to a ticket.",
    inputSchema: { type: "object", properties: { ticketId: { type: "string" }, note: { type: "string" } }, required: ["ticketId", "note"] },
    requiresApproval: false,
  },
  {
    agentDomain: "helpdesk",
    toolName: "escalate_ticket",
    description: "Escalate a ticket to the next support tier.",
    inputSchema: { type: "object", properties: { ticketId: { type: "string" }, tier: { type: "string" } }, required: ["ticketId"] },
    requiresApproval: true,
  },
  {
    agentDomain: "helpdesk",
    toolName: "close_ticket",
    description: "Close a ticket with a resolution code.",
    inputSchema: { type: "object", properties: { ticketId: { type: "string" }, resolutionCode: { type: "string" } }, required: ["ticketId", "resolutionCode"] },
    requiresApproval: true,
  },
];

/** Templates for one domain, or every template when no domain is given. */
export function defaultToolsFor(agentDomain?: string): DefaultToolTemplate[] {
  if (agentDomain === undefined) return [...DEFAULT_TOOL_TEMPLATES];
  return DEFAULT_TOOL_TEMPLATES.filter((t) => t.agentDomain === agentDomain);
}
