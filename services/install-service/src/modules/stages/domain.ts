/**
 * Stage (install "step") lifecycle — the single source of truth for which verb
 * is legal from which status. Used by the route (fast 409) AND re-checked by the
 * consumer inside its transaction so a racing command can never apply an
 * illegal transition.
 *
 * `active` is the legacy create-time default and behaves exactly like `pending`.
 * The web (InstallStepActions) offers: Run on pending/skipped, Retry on failed,
 * Skip on pending/failed, Mark complete / Mark failed on in_progress (fail needs remarks).
 */
export type StageVerb = "run" | "skip" | "retry" | "complete" | "fail";
export type StageTarget = "in_progress" | "skipped" | "completed" | "failed";

const TRANSITIONS: Record<StageVerb, { from: readonly string[]; to: StageTarget }> = {
  run: { from: ["pending", "active", "skipped"], to: "in_progress" },
  retry: { from: ["failed"], to: "in_progress" },
  skip: { from: ["pending", "active", "failed"], to: "skipped" },
  // Q9: nothing else advances a stage past in_progress, so an install admin closes it by hand.
  complete: { from: ["in_progress"], to: "completed" },
  fail: { from: ["in_progress"], to: "failed" },
};

/** The status a verb moves a stage to, or null when the verb is not legal from `current`. */
export function nextStageStatus(verb: StageVerb, current: string): StageTarget | null {
  const t = TRANSITIONS[verb];
  return t.from.includes(current) ? t.to : null;
}
