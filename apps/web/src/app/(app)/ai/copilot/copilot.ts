/**
 * Pure helpers for the copilot console.
 *
 * Nothing here re-derives anything the service owns. In particular the latency
 * *bucket* is deliberately not computed client-side: ai-agent-service owns those
 * thresholds and returns the bucket on the turn detail response, so duplicating
 * them here would let the two drift apart.
 */
import type { CopilotTurn } from "@civitasone/types";

export type TurnState = "answered" | "awaiting";

/**
 * A turn is created the moment the prompt is accepted (202) and gets its
 * response later, when the consumer has run. Until then it is genuinely
 * awaiting — the console says so rather than showing an empty answer.
 */
export function turnState(turn: CopilotTurn): TurnState {
  return turn.response !== null && turn.response.trim().length > 0 ? "answered" : "awaiting";
}

export interface TurnSummary {
  total: number;
  answered: number;
  awaiting: number;
  /** Mean latency across turns that recorded one; 0 when none did. */
  averageLatencyMs: number;
  totalTokens: number;
}

export function summariseTurns(turns: CopilotTurn[]): TurnSummary {
  let answered = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let totalTokens = 0;

  for (const turn of turns) {
    if (turnState(turn) === "answered") answered += 1;
    if (typeof turn.latencyMs === "number") {
      latencySum += turn.latencyMs;
      latencyCount += 1;
    }
    if (typeof turn.tokens === "number") totalTokens += turn.tokens;
  }

  return {
    total: turns.length,
    answered,
    awaiting: turns.length - answered,
    averageLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
    totalTokens,
  };
}

/** Prompts run to 32k characters; the table shows a readable head of one. */
export function truncatePrompt(prompt: string, max = 90): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1).trimEnd()}…`;
}

export function citationCount(turn: CopilotTurn): number {
  return turn.sourceCitations.length;
}

/**
 * Pulls readable guardrail violation messages out of a 422 GUARDRAIL_BLOCKED
 * body. The response is shaped by the guardrails module, but this runs on an
 * error path, so it is written to survive a body that does not match: the user
 * must still be told the prompt was blocked even if the detail is unreadable.
 */
export function guardrailViolationMessages(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const details = (body as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return [];
  const violations = (details as { violations?: unknown }).violations;
  if (!Array.isArray(violations)) return [];

  const messages: string[] = [];
  for (const violation of violations) {
    if (typeof violation === "string") {
      messages.push(violation);
      continue;
    }
    if (typeof violation === "object" && violation !== null) {
      const message = (violation as { message?: unknown }).message;
      if (typeof message === "string" && message.length > 0) messages.push(message);
    }
  }
  return messages;
}
