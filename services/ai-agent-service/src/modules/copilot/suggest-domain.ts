/**
 * copilot/suggest-domain.ts — F.3 employee copilot suggestion envelope.
 * Pure functions only: the envelope is deterministic so the same context always
 * produces the same next-step guidance, which is what makes it reviewable.
 */

export type TaskType =
  | "draft_reply"
  | "summarize"
  | "next_action"
  | "classify"
  | "escalate"
  | "explain";

export const TASK_TYPES: readonly TaskType[] = [
  "draft_reply",
  "summarize",
  "next_action",
  "classify",
  "escalate",
  "explain",
];

export function validateTaskType(taskType: string): string | null {
  if (!TASK_TYPES.includes(taskType as TaskType)) {
    return `taskType must be one of: ${TASK_TYPES.join(", ")}`;
  }
  return null;
}

/** Steps a copilot proposes per task type. Ordered — step 1 first. */
const PLAYBOOKS: Record<TaskType, readonly string[]> = {
  draft_reply: [
    "Identify the requester and the specific question asked",
    "Cite the governing rule or circular that applies",
    "Draft a reply in the requester's language with the decision and next step",
  ],
  summarize: [
    "Extract decisions, owners and dates from the supplied context",
    "Separate what is settled from what is still open",
    "Produce a summary ordered newest-first",
  ],
  next_action: [
    "Determine the current stage and who holds the file",
    "Check whether any statutory clock is running",
    "Propose the single next action with its due date",
  ],
  classify: [
    "Match the context against the configured category list",
    "Note the two closest categories and why one wins",
    "Return the category with a confidence band",
  ],
  escalate: [
    "State the breach or risk that justifies escalation",
    "Identify the next authority in the delegation chain",
    "Assemble the escalation note with evidence references",
  ],
  explain: [
    "Restate the question in plain language",
    "Explain the applicable rule with its source",
    "Give a worked example using the supplied context",
  ],
};

export interface SuggestionInput {
  taskType: TaskType;
  context: Record<string, unknown>;
}

export interface SuggestionEnvelope {
  taskType: TaskType;
  steps: string[];
  /** Keys of the supplied context that the playbook could actually use. */
  groundedOn: string[];
  /** "low" | "medium" | "high" — how much context backs the suggestion. */
  confidence: "low" | "medium" | "high";
  /** True when the caller supplied no usable context: the copilot is guessing. */
  needsMoreContext: boolean;
  disclaimer: string;
}

const DISCLAIMER =
  "Suggestion only — an authorised officer must verify the applicable rule before acting.";

/**
 * Build the suggestion envelope.
 *
 * Confidence is derived from how much context was supplied, not from model
 * self-assessment: a copilot that claims high confidence on an empty context is
 * the failure mode that gets an officer into trouble.
 */
export function buildSuggestion(input: SuggestionInput): SuggestionEnvelope {
  const groundedOn = Object.entries(input.context)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k]) => k)
    .sort();

  const confidence = groundedOn.length >= 3 ? "high" : groundedOn.length >= 1 ? "medium" : "low";

  return {
    taskType: input.taskType,
    steps: [...PLAYBOOKS[input.taskType]],
    groundedOn,
    confidence,
    needsMoreContext: groundedOn.length === 0,
    disclaimer: DISCLAIMER,
  };
}
