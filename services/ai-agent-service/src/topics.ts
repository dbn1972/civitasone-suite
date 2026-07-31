/** Topic + event names owned by ai-agent-service. {service}.{entity}.{action} */
export const COMMANDS = {
  sendMessage: "ai.chat.send",
  askCopilot: "ai.copilot.ask",
  summarize: "ai.copilot.summarize",
  invokeAgent: "ai.agent.invoke",
  pauseAgent: "ai.agent.pause",
  checkGuardrails: "ai.guardrails.check",
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
} as const;

/** Inbound events consumed from other services. */
export const INBOUND = {} as const;

/** Audit sink consumed by audit-service. */
export const AUDIT_TOPIC = "audit.event.record";

export const SERVICE = "ai-agent";
