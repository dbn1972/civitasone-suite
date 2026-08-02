/**
 * F.5 — AI pause/resume protocol for human handoff (pure state machine).
 *
 * States
 *   ai_handling    the AI agent owns the conversation and replies automatically
 *   paused         the AI has stopped replying; nobody owns the conversation yet
 *   human_handling a named human agent owns the conversation; the AI stays silent
 *   closed         terminal
 *
 * Actions
 *   pause          stop the AI replying
 *   assign_human   hand ownership to a named human agent (requires agentId)
 *   resume_ai      give the conversation back to the AI
 *   close          end the conversation
 *
 * Deliberate omissions, so the machine stays small and every rejection is
 * meaningful:
 *   - `assign_human` from `human_handling` is INVALID. Reassignment between
 *     humans is a different operation (it does not change the AI's state) and
 *     modelling it here would make "is the AI paused?" ambiguous.
 *   - `pause` from `paused` is INVALID — pausing something already paused hides
 *     a double-submit rather than reporting it.
 *   - `closed` accepts nothing. A closed conversation is reopened by starting a
 *     new one, which keeps the audit trail unambiguous.
 */

export const HANDOFF_STATES = ["ai_handling", "paused", "human_handling", "closed"] as const;
export type HandoffState = (typeof HANDOFF_STATES)[number];

export const HANDOFF_ACTIONS = ["pause", "assign_human", "resume_ai", "close"] as const;
export type HandoffAction = (typeof HANDOFF_ACTIONS)[number];

/** The conversation's state before any handoff has ever been recorded. */
export const INITIAL_HANDOFF_STATE: HandoffState = "ai_handling";

/** Complete transition table. Absence of a key means the transition is invalid. */
const TRANSITIONS: Record<HandoffState, Partial<Record<HandoffAction, HandoffState>>> = {
  ai_handling: {
    pause: "paused",
    assign_human: "human_handling",
    close: "closed",
  },
  paused: {
    assign_human: "human_handling",
    resume_ai: "ai_handling",
    close: "closed",
  },
  human_handling: {
    pause: "paused",
    resume_ai: "ai_handling",
    close: "closed",
  },
  closed: {},
};

export type TransitionResult =
  | { ok: true; from: HandoffState; to: HandoffState; action: HandoffAction; aiPaused: boolean }
  | { ok: false; code: "INVALID_TRANSITION" | "AGENT_REQUIRED"; message: string };

export type TransitionInput = {
  action: HandoffAction;
  /** Required when action is assign_human. */
  agentId?: string | null | undefined;
};

/**
 * Apply an action to a state. Returns the new state, or a typed rejection —
 * never throws, so callers map the rejection onto an HTTP status without
 * exception plumbing.
 */
export function applyHandoffTransition(
  from: HandoffState, input: TransitionInput,
): TransitionResult {
  const next = TRANSITIONS[from][input.action];
  if (next === undefined) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `cannot ${input.action} a conversation in state ${from}`,
    };
  }
  if (input.action === "assign_human" && (input.agentId === undefined || input.agentId === null || input.agentId === "")) {
    return {
      ok: false,
      code: "AGENT_REQUIRED",
      message: "assign_human requires an agentId — an unassigned handoff has no owner",
    };
  }
  return { ok: true, from, to: next, action: input.action, aiPaused: isAiPaused(next) };
}

/** True while the AI must not reply. The single question the send path asks. */
export function isAiPaused(state: HandoffState): boolean {
  return state === "paused" || state === "human_handling" || state === "closed";
}

/** Actions that are legal from a given state — powers the UI's button set. */
export function allowedActions(from: HandoffState): HandoffAction[] {
  return HANDOFF_ACTIONS.filter((a) => TRANSITIONS[from][a] !== undefined);
}

export function isHandoffState(value: string): value is HandoffState {
  return (HANDOFF_STATES as readonly string[]).includes(value);
}
