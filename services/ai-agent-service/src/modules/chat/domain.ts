/**
 * chat/domain.ts — conversation state machine + turn helpers. Pure functions.
 */

export type ConversationStatus = "active" | "ended";
export type MessageRole = "user" | "assistant" | "system";

export const CONVERSATION_STATUSES: readonly ConversationStatus[] = ["active", "ended"];
export const MESSAGE_ROLES: readonly MessageRole[] = ["user", "assistant", "system"];

/** active → ended is the only legal move; `ended` is terminal. */
const TRANSITIONS: Record<ConversationStatus, readonly ConversationStatus[]> = {
  active: ["ended"],
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
