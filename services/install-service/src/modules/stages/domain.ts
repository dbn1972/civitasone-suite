/**
 * Stage (install "step") lifecycle — the single source of truth for which verb
 * is legal from which status. Used by the route (fast 409) AND re-checked by the
 * consumer inside its transaction so a racing command can never apply an
 * illegal transition.
 *
 * `active` is the legacy create-time default and behaves exactly like `pending`.
 * The web (InstallStepActions) offers: Run on pending/skipped, Retry on failed,
 * Skip on pending/failed.
 */
export type StageVerb = "run" | "skip" | "retry";

const TRANSITIONS: Record<StageVerb, { from: readonly string[]; to: "in_progress" | "skipped" }> = {
  run: { from: ["pending", "active", "skipped"], to: "in_progress" },
  retry: { from: ["failed"], to: "in_progress" },
  skip: { from: ["pending", "active", "failed"], to: "skipped" },
};

/** The status a verb moves a stage to, or null when the verb is not legal from `current`. */
export function nextStageStatus(verb: StageVerb, current: string): "in_progress" | "skipped" | null {
  const t = TRANSITIONS[verb];
  return t.from.includes(current) ? t.to : null;
}
