/** Topic + event names owned by ai-agent-service. {service}.{entity}.{action} */
export const COMMANDS = {
  sendMessage: "ai.chat.send",
  askCopilot: "ai.copilot.ask",
  summarize: "ai.copilot.summarize",
  invokeAgent: "ai.agent.invoke",
  pauseAgent: "ai.agent.pause",
  checkGuardrails: "ai.guardrails.check",
  // Sprint 2 — AG-001 / AG-003 / AG-004 / F.3 / F.4
  startOrchestration: "ai.orchestration.start",
  recordHandoff: "ai.orchestration.handoff",
  abortOrchestration: "ai.orchestration.abort",
  publishAgentDefinition: "ai.authoring.publish",
  scoreInteraction: "ai.quality.score",
  startChatSession: "ai.chat.session_start",
  suggest: "ai.copilot.suggest",
  recordReactStep: "ai.agent.react_step",
} as const;

export const EVENTS = {
  /** Emitted when a new conversation is initiated by a user. */
  conversationStarted: "ai.conversation.started",
  /** Emitted when a copilot/chat turn completes (response generated). */
  turnCompleted: "ai.turn.completed",
  /** Emitted when a multi-agent handoff occurs between agents. */
  handoffTriggered: "ai.agent.handoff_triggered",
  /** Emitted when an agent is paused (manual or governance). */
  agentPaused: "ai.agent.paused",

  // ── AG-001 orchestration ──────────────────────────────────────────────────
  /** Payload: { orchestrationId, rootAgentId, maxDepth, maxHops }. Fires when an orchestration is started. */
  orchestrationStarted: "ai.orchestration.started",
  /** Payload: { orchestrationId, hopId, fromAgentId, toAgentId, depth, hopCount }. Fires on each recorded handoff. */
  orchestrationHopRecorded: "ai.orchestration.hop_recorded",
  /** Payload: { orchestrationId, code, depth, hopCount }. Fires when a handoff is refused by the recursion safety valve. */
  orchestrationLimitExceeded: "ai.orchestration.limit_exceeded",
  /** Payload: { orchestrationId, reason }. Fires when an orchestration is aborted by an operator. */
  orchestrationAborted: "ai.orchestration.aborted",

  // ── AG-003 authoring ──────────────────────────────────────────────────────
  /** Payload: { definitionId, name }. Fires when an authored agent definition is created. */
  agentDefinitionDrafted: "ai.authoring.drafted",
  /** Payload: { definitionId, name, toolCount }. Fires when a draft is published. */
  agentDefinitionPublished: "ai.authoring.published",
  /** Payload: { definitionId }. Fires when an authored definition is archived. */
  agentDefinitionArchived: "ai.authoring.archived",

  // ── AG-004 quality ────────────────────────────────────────────────────────
  /** Payload: { conversationId, turnId, overall, flagged }. Fires on every scored interaction. */
  interactionScored: "ai.quality.scored",
  /** Payload: { conversationId, turnId, flagReason }. Fires when a score is flagged for human review. */
  interactionFlagged: "ai.quality.flagged",

  // ── AG-005 protocols ──────────────────────────────────────────────────────
  /** Payload: { registrationId, protocol }. Fires when an interop protocol endpoint is registered. */
  protocolRegistered: "ai.protocol.registered",
  /** Payload: { registrationId, protocol, enabled }. Fires when a registration is updated. */
  protocolUpdated: "ai.protocol.updated",

  // ── F.4 governed tools / ReAct ────────────────────────────────────────────
  /** Payload: { toolId, agentDomain, toolName, requiresApproval }. Fires when a tool definition is created. */
  toolDefined: "ai.tool.defined",
  /** Payload: { toolId, agentDomain, toolName }. Fires when a tool definition is updated. */
  toolUpdated: "ai.tool.updated",
  /** Payload: { agentId, stepId, action, executed }. Fires when a ReAct step is recorded. */
  reactStepRecorded: "ai.agent.react_step_recorded",
  /** Payload: { agentId, stepId, action, toolId }. Fires when a step is held for human approval. */
  reactStepPendingApproval: "ai.agent.react_step_pending_approval",

  // ── F.8 prompt injection ──────────────────────────────────────────────────
  /** Payload: { severity, patterns, blocked }. Fires when injection patterns are detected. Never carries prompt text. */
  injectionDetected: "ai.guardrails.injection_detected",
} as const;

/** Inbound events consumed from other services. */
export const INBOUND = {} as const;

/** Audit sink consumed by audit-service. */
export const AUDIT_TOPIC = "audit.event.record";

export const SERVICE = "ai-agent";
