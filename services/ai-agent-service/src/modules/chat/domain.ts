/**
 * chat/domain.ts — conversation state machine + turn helpers. Pure functions.
 */

export type ConversationStatus = "active" | "handed_off" | "ended";
export type MessageRole = "user" | "assistant" | "system";

export const CONVERSATION_STATUSES: readonly ConversationStatus[] = [
  "active",
  "handed_off",
  "ended",
];
export const MESSAGE_ROLES: readonly MessageRole[] = ["user", "assistant", "system"];

/**
 * A conversation escalated to a human (`handed_off`) can still be closed, but it
 * can never fall back to `active` — that would silently return the customer to
 * the bot after an agent took ownership. `ended` is terminal.
 */
const TRANSITIONS: Record<ConversationStatus, readonly ConversationStatus[]> = {
  active: ["handed_off", "ended"],
  handed_off: ["ended"],
  ended: [],
};

/** Returns null when the transition is legal, else an error message. */
export function validateStatusTransition(from: string, to: string): string | null {
  if (!CONVERSATION_STATUSES.includes(from as ConversationStatus)) {
    return `unknown conversation status: ${from}`;
  }
  if (!CONVERSATION_STATUSES.includes(to as ConversationStatus)) {
    return `unknown conversation status: ${to}`;
  }
  const allowed = TRANSITIONS[from as ConversationStatus];
  if (!allowed.includes(to as ConversationStatus)) {
    return `cannot transition conversation from ${from} to ${to}`;
  }
  return null;
}

/** Returns null when the role is legal, else an error message. */
export function validateMessageRole(role: string): string | null {
  if (!MESSAGE_ROLES.includes(role as MessageRole)) {
    return `role must be one of: ${MESSAGE_ROLES.join(", ")}`;
  }
  return null;
}

/** Coarse token estimate — ~4 characters per token. Never negative. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// ── Human handoff (BRD P2-3) ─────────────────────────────────────────────────

/**
 * Why a conversation left the bot. `requested` is the customer asking for a
 * person; `low_confidence` is the bot escalating itself; `guardrail` is a
 * blocked exchange that needs a human; `agent_initiated` is an operator
 * pulling the conversation manually.
 */
export type HandoffReasonCode =
  | "requested"
  | "low_confidence"
  | "guardrail"
  | "agent_initiated";

export const HANDOFF_REASON_CODES: readonly HandoffReasonCode[] = [
  "requested",
  "low_confidence",
  "guardrail",
  "agent_initiated",
];

/**
 * Confidence at or below this is treated as "the bot does not know".
 * Chosen to match the copilot `low` confidence band so a bot that reports
 * low confidence and a bot that scores 0.4 escalate identically.
 */
export const LOW_CONFIDENCE_THRESHOLD = 0.5;

/** Phrases that mean "get me a person", matched case-insensitively. */
const ARTICLE = "(?:an?|the)\\s+";
const HUMAN_REQUEST_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `\\b(?:speak|talk|connect|transfer)\\s+(?:me\\s+)?(?:to|with)\\s+(?:${ARTICLE})?` +
      "(?:human|person|agent|representative|operator|executive)\\b",
    "i",
  ),
  /\b(?:human|live)\s+(?:agent|person|support|operator|executive)\b/i,
  /\breal\s+person\b/i,
  /\b(?:customer\s+)?care\s+executive\b/i,
];

/** True when the customer explicitly asked to be put through to a person. */
export function isHumanRequested(message: string): boolean {
  if (!message) return false;
  return HUMAN_REQUEST_PATTERNS.some((re) => re.test(message));
}

export interface HandoffDecisionInput {
  message?: string;
  /** Bot self-reported confidence in [0,1]. Undefined means "not scored". */
  confidence?: number | null;
  /** Guardrail violations recorded on the turn. */
  violationCount?: number;
}

export interface HandoffDecision {
  handoff: boolean;
  reasonCode: HandoffReasonCode | null;
}

/**
 * Decide whether a turn should leave the bot. An explicit customer request wins
 * over everything else so the reason recorded matches what the customer did.
 */
export function decideHandoff(input: HandoffDecisionInput): HandoffDecision {
  if (isHumanRequested(input.message ?? "")) {
    return { handoff: true, reasonCode: "requested" };
  }
  if (typeof input.confidence === "number" && input.confidence <= LOW_CONFIDENCE_THRESHOLD) {
    return { handoff: true, reasonCode: "low_confidence" };
  }
  if ((input.violationCount ?? 0) > 0) {
    return { handoff: true, reasonCode: "guardrail" };
  }
  return { handoff: false, reasonCode: null };
}

/** Returns null when the reason code is legal, else an error message. */
export function validateHandoffReason(code: string): string | null {
  if (!HANDOFF_REASON_CODES.includes(code as HandoffReasonCode)) {
    return `handoff reason must be one of: ${HANDOFF_REASON_CODES.join(", ")}`;
  }
  return null;
}

/** How many trailing transcript messages travel with the handoff. */
export const HANDOFF_CONTEXT_TURNS = 10;

export interface HandoffContext {
  conversationId: string;
  language: string;
  reasonCode: HandoffReasonCode;
  note: string | null;
  summary: TurnSummary;
  /** Trailing slice of the transcript, oldest first. Already PII-redacted. */
  recentTurns: { role: string; content: string }[];
}

/**
 * Package what the bot knows so the receiving human starts informed rather than
 * asking the customer to repeat themselves. `messages` must already be the
 * guardrail-sanitised transcript — this does not redact.
 */
export function buildHandoffContext(input: {
  conversationId: string;
  language: string;
  reasonCode: HandoffReasonCode;
  note?: string | null;
  messages: TurnSummaryInput[];
}): HandoffContext {
  const recent = input.messages.slice(-HANDOFF_CONTEXT_TURNS);
  return {
    conversationId: input.conversationId,
    language: input.language,
    reasonCode: input.reasonCode,
    note: input.note ?? null,
    summary: buildTurnSummary(input.messages),
    recentTurns: recent.map((m) => ({ role: m.role, content: m.content })),
  };
}

export interface TurnSummaryInput {
  role: string;
  content: string;
  tokens?: number | null;
}

export interface TurnSummary {
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  systemMessages: number;
  totalTokens: number;
  lastRole: string | null;
}

/**
 * Aggregate a transcript into a compact summary for `turnCompleted` events.
 * Messages without a stored token count fall back to the estimate.
 */
export function buildTurnSummary(messages: TurnSummaryInput[]): TurnSummary {
  let totalTokens = 0;
  let userMessages = 0;
  let assistantMessages = 0;
  let systemMessages = 0;

  for (const m of messages) {
    totalTokens += m.tokens ?? estimateTokens(m.content);
    if (m.role === "user") userMessages += 1;
    else if (m.role === "assistant") assistantMessages += 1;
    else if (m.role === "system") systemMessages += 1;
  }

  const last = messages.length > 0 ? messages[messages.length - 1] : undefined;

  return {
    messageCount: messages.length,
    userMessages,
    assistantMessages,
    systemMessages,
    totalTokens,
    lastRole: last?.role ?? null,
  };
}
