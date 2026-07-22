// scripts/governance/types.ts
//
// Shared vocabulary used across every module in scripts/governance/.
// Mirrors the "Data Models" section of the design document for the
// agent-context-governance-refresh feature — kept here as the single
// source of truth so steering-audit.ts, steering-refresh.ts,
// reconcile-services.ts, skills-audit.ts, hooks-validate.ts,
// hooks-referenced-paths.ts, governance-report.ts, and run.ts all
// import the same shapes rather than redeclaring them.

/**
 * How a Steering_Document is injected into agent context.
 *
 * - "always": no `inclusion` front-matter (or `inclusion: always`) — injected
 *   into every agent interaction regardless of the files being worked on.
 * - { mode: "fileMatch" }: injected only when the active file matches `pattern`.
 * - { mode: "manual" }: injected only when explicitly referenced.
 */
export type SteeringInclusion =
  | "always"
  | { mode: "fileMatch"; pattern: string }
  | { mode: "manual" };

/**
 * Identifying metadata for a single Steering_Document under `.kiro/steering/`.
 */
export interface SteeringDocMeta {
  path: string;
  inclusion: SteeringInclusion;
}

/**
 * A single proposed change to an Agent_Hook file, produced by the
 * Validation_Process / Refresh_Process.
 *
 * `touchesRolesCommandsOrBusinessRules` is the computed flag that drives the
 * apply-vs-flag gate (design Property 10): corrections that would change the
 * set of roles implied by the hook, the command being run, or a business-rule
 * sentence in the prompt are always `true` and must never be auto-applied.
 * Purely mechanical fixes (a stale path string, a typo'd enum value, a missing
 * `version` key) are `false`.
 */
export interface Correction {
  hookFile: string;
  field: string; // e.g. "then.prompt", "when.patterns[1]"
  before: string;
  after: string;
  touchesRolesCommandsOrBusinessRules: boolean;
}

/**
 * The final validation status recorded for an Agent_Hook in the
 * Governance_Report. Every hook appears with exactly one of these.
 */
export type HookFinalStatus = "valid" | "corrected" | "needs-manual-review";
