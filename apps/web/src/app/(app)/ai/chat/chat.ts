/**
 * Pure helpers for the AI chat screens.
 *
 * Conversation status transitions are owned by ai-agent-service; nothing here
 * decides whether a transition is legal. These helpers only summarise and format.
 */
import type { ChatConversation, ChatMessage } from "@civitasone/types";

export interface ConversationSummary {
  total: number;
  active: number;
  handedOff: number;
  ended: number;
}

export function summariseConversations(conversations: ChatConversation[]): ConversationSummary {
  let active = 0;
  let handedOff = 0;
  let ended = 0;
  for (const conversation of conversations) {
    if (conversation.status === "active") active += 1;
    else if (conversation.status === "handed_off") handedOff += 1;
    else if (conversation.status === "ended") ended += 1;
  }
  return { total: conversations.length, active, handedOff, ended };
}

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  handed_off: "With agent",
  ended: "Ended",
};

/** Human-readable conversation status. Unknown values pass through unchanged
 *  so a status added by the service is visible rather than silently mislabelled. */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

const HANDOFF_REASON_LABEL: Record<string, string> = {
  requested: "Citizen asked for a person",
  low_confidence: "Assistant was unsure",
  guardrail: "Guardrail flagged the exchange",
  agent_initiated: "Taken over by an operator",
};

export function handoffReasonLabel(reason: string | null): string | null {
  if (reason === null) return null;
  return HANDOFF_REASON_LABEL[reason] ?? reason;
}

/** A handed-off conversation is still open, so it has no duration yet. */
export function isOpen(conversation: ChatConversation): boolean {
  return conversation.status === "active" || conversation.status === "handed_off";
}

/**
 * Wall-clock duration of a conversation in whole minutes, or null when it is
 * still running or the timestamps are unusable. Returns null rather than 0 for
 * an open conversation so the UI can say "in progress" instead of "0 min".
 */
export function conversationDurationMinutes(conversation: ChatConversation): number | null {
  if (conversation.endedAt === null) return null;
  const started = new Date(conversation.startedAt).getTime();
  const ended = new Date(conversation.endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) return null;
  return Math.round((ended - started) / 60000);
}

export const ROLE_LABEL: Record<string, string> = {
  user: "Citizen",
  assistant: "Assistant",
  system: "System",
};

export function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

export interface TranscriptStats {
  messages: number;
  userMessages: number;
  assistantMessages: number;
  totalTokens: number;
}

export function summariseTranscript(messages: ChatMessage[]): TranscriptStats {
  let userMessages = 0;
  let assistantMessages = 0;
  let totalTokens = 0;
  for (const message of messages) {
    if (message.role === "user") userMessages += 1;
    if (message.role === "assistant") assistantMessages += 1;
    if (typeof message.tokens === "number") totalTokens += message.tokens;
  }
  return { messages: messages.length, userMessages, assistantMessages, totalTokens };
}

/**
 * Orders a transcript oldest-first so it reads as a conversation. Falls back to
 * message id when two messages share a timestamp, which happens when a turn and
 * its reply are written in the same millisecond.
 */
export function inReadingOrder(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const at = new Date(a.createdAt).getTime();
    const bt = new Date(b.createdAt).getTime();
    if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}
