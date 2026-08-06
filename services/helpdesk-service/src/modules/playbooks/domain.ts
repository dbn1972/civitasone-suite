/**
 * G13 Resolution Playbooks — pure domain logic.
 *
 * Product spec: "SLA-driven resolution with product-specific playbooks (for
 * example, Speed Post delay versus SCSS interest-posting query versus PLI claim
 * status)". This is the Dynamics 365 "Playbook" / Salesforce "Guided Action"
 * equivalent: an ordered, versioned set of guided steps that an agent works
 * through for a particular class of ticket.
 *
 * Everything in this file is pure and deterministic — no clock, no DB, no
 * randomness. Time is always injected. That is what makes playbook resolution
 * auditable: the same candidate set and the same ticket ALWAYS yield the same
 * playbook, so two identical tickets can never diverge.
 */

// ── Types ───────────────────────────────────────────────────────────────────

export type PlaybookStatus = "draft" | "published" | "deprecated";

export const PLAYBOOK_STATUSES: readonly PlaybookStatus[] = ["draft", "published", "deprecated"];

export type PlaybookStepType = "instruction" | "task" | "knowledge_link" | "form" | "escalate";

export const PLAYBOOK_STEP_TYPES: readonly PlaybookStepType[] = [
  "instruction",
  "task",
  "knowledge_link",
  "form",
  "escalate",
];

export type RunStatus = "in_progress" | "completed" | "abandoned";

/** One guided step. Stored as an element of the playbook's `steps` JSONB array. */
export interface PlaybookStep {
  /** Stable within a playbook version; run-step completion rows reference it. */
  id: string;
  /** 1-based presentation order. Unique within a playbook version. */
  ordinal: number;
  type: PlaybookStepType;
  title: string;
  body: string;
  /** A run cannot be completed while a mandatory step is outstanding. */
  mandatory: boolean;
  /** Minutes after run start by which this step should be done (null = untimed). */
  slaOffsetMinutes: number | null;
  /** knowledge-service article id — required for `knowledge_link` steps. */
  knowledgeArticleId: string | null;
}

/**
 * The four matching dimensions. `null` on a PLAYBOOK means "matches anything"
 * (a wildcard). `null` on a TICKET means "this ticket has no value for that
 * dimension", so only wildcard playbooks can match it there.
 */
export interface MatchCriteria {
  categoryId: string | null;
  productCode: string | null;
  ticketType: string | null;
  priority: string | null;
}

/** The minimum a playbook row must expose for resolution to work. */
export interface PlaybookCandidate extends MatchCriteria {
  id: string;
  playbookKey: string;
  versionNumber: number;
  status: PlaybookStatus;
  publishedAt: Date | null;
}

/** Per-step completion state of a live run. */
export interface RunStepState {
  stepId: string;
  ordinal: number;
  mandatory: boolean;
  completedAt: Date | null;
  completedBy: string | null;
}

// ── Criteria matching ───────────────────────────────────────────────────────

/**
 * Compare one matching dimension case-insensitively. Case folding matters
 * because priority arrives as "High" from the ticket API but tenants configure
 * playbooks by hand ("high"), and a case-sensitive miss would silently resolve
 * to a less specific playbook.
 */
function sameValue(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** The dimensions a playbook constrains, i.e. its non-null criteria. */
function constrainedDimensions(candidate: MatchCriteria): Array<[keyof MatchCriteria, string]> {
  const out: Array<[keyof MatchCriteria, string]> = [];
  const keys: Array<keyof MatchCriteria> = ["categoryId", "productCode", "ticketType", "priority"];
  for (const k of keys) {
    const v = candidate[k];
    if (v !== null && v !== undefined && v !== "") out.push([k, v]);
  }
  return out;
}

/**
 * How specific a playbook is: the number of dimensions it constrains (0–4).
 * A playbook constraining nothing (specificity 0) is the tenant's catch-all.
 */
export function specificity(candidate: MatchCriteria): number {
  return constrainedDimensions(candidate).length;
}

/**
 * True when every dimension the playbook constrains equals the ticket's value
 * for that dimension. Unconstrained (null) playbook dimensions are wildcards
 * and always match; a constrained dimension can never match a ticket whose
 * value for it is null.
 */
export function criteriaMatches(candidate: MatchCriteria, ticket: MatchCriteria): boolean {
  for (const [key, want] of constrainedDimensions(candidate)) {
    const got = ticket[key];
    if (got === null || got === undefined || got === "") return false;
    if (!sameValue(want, got)) return false;
  }
  return true;
}

/**
 * Total ordering over eligible playbooks — the documented, deterministic
 * precedence rule. Negative means `a` wins.
 *
 *   1. MOST SPECIFIC WINS  — more constrained dimensions matched beats fewer.
 *   2. MOST RECENTLY PUBLISHED — a newer curated playbook supersedes an older
 *      one at the same specificity. A null publishedAt sorts last.
 *   3. playbookKey ASCENDING (byte order, not locale — locale collation varies
 *      by server and would make resolution environment-dependent).
 *   4. versionNumber DESCENDING — the latest version of the same key.
 *   5. id ASCENDING — final total-order tiebreak so the comparator is never
 *      indifferent between two distinct rows. Without this, Array.prototype.sort
 *      could return either row for otherwise-identical candidates.
 */
export function comparePrecedence(a: PlaybookCandidate, b: PlaybookCandidate): number {
  const bySpecificity = specificity(b) - specificity(a);
  if (bySpecificity !== 0) return bySpecificity;

  const aPub = a.publishedAt ? a.publishedAt.getTime() : Number.NEGATIVE_INFINITY;
  const bPub = b.publishedAt ? b.publishedAt.getTime() : Number.NEGATIVE_INFINITY;
  if (aPub !== bPub) return bPub - aPub;

  if (a.playbookKey !== b.playbookKey) return a.playbookKey < b.playbookKey ? -1 : 1;

  if (a.versionNumber !== b.versionNumber) return b.versionNumber - a.versionNumber;

  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

/**
 * Resolve the best-matching PUBLISHED playbook for a ticket, or null when none
 * matches (a normal, expected outcome — most tenants only curate playbooks for
 * a handful of ticket classes).
 *
 * Draft and deprecated playbooks are never resolved: a draft is unreviewed, and
 * a deprecated one has been deliberately retired.
 */
export function resolvePlaybook(
  candidates: readonly PlaybookCandidate[],
  ticket: MatchCriteria,
): PlaybookCandidate | null {
  const eligible = candidates.filter((c) => c.status === "published" && criteriaMatches(c, ticket));
  if (eligible.length === 0) return null;
  return [...eligible].sort(comparePrecedence)[0] ?? null;
}

/**
 * The full ranked candidate list — same rule as resolvePlaybook, exposed so the
 * resolve endpoint can explain WHY a playbook won (auditability) without
 * re-implementing the ordering.
 */
export function rankCandidates(
  candidates: readonly PlaybookCandidate[],
  ticket: MatchCriteria,
): PlaybookCandidate[] {
  return candidates
    .filter((c) => c.status === "published" && criteriaMatches(c, ticket))
    .sort(comparePrecedence);
}

// ── Step definition validation ──────────────────────────────────────────────

/**
 * Cross-field step validation that zod cannot express per-element: uniqueness
 * of ids and ordinals across the array, and the knowledge_link → article
 * requirement. Returns human-readable errors; empty array means valid.
 */
export function validateSteps(steps: readonly PlaybookStep[]): string[] {
  const errors: string[] = [];
  if (steps.length === 0) errors.push("a playbook needs at least one step");

  const seenIds = new Set<string>();
  const seenOrdinals = new Set<number>();
  for (const s of steps) {
    if (seenIds.has(s.id)) errors.push(`duplicate step id: ${s.id}`);
    seenIds.add(s.id);
    if (seenOrdinals.has(s.ordinal)) errors.push(`duplicate step ordinal: ${s.ordinal}`);
    seenOrdinals.add(s.ordinal);
    if (s.ordinal < 1) errors.push(`step '${s.id}' ordinal must be >= 1`);
    if (s.type === "knowledge_link" && !s.knowledgeArticleId) {
      errors.push(`step '${s.id}' is a knowledge_link and needs a knowledgeArticleId`);
    }
    if (s.slaOffsetMinutes !== null && s.slaOffsetMinutes < 0) {
      errors.push(`step '${s.id}' slaOffsetMinutes cannot be negative`);
    }
  }
  return errors;
}

/**
 * Sort by ordinal and renumber 1..n so stored steps are always dense and
 * gapless — clients may submit 10/20/30 spacing, and a run's step list is
 * presented in ordinal order.
 */
export function normaliseSteps(steps: readonly PlaybookStep[]): PlaybookStep[] {
  return [...steps]
    .sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((s, i) => ({ ...s, ordinal: i + 1 }));
}

// ── Playbook lifecycle ──────────────────────────────────────────────────────

/**
 * Only drafts may be edited. A published playbook is immutable because live
 * runs snapshot-reference its steps by id — editing it in place would rewrite
 * the history of work already done.
 */
export function canEdit(status: PlaybookStatus): boolean {
  return status === "draft";
}

/** A draft with at least one valid step may be published. */
export function canPublish(status: PlaybookStatus, steps: readonly PlaybookStep[]): boolean {
  return status === "draft" && validateSteps(steps).length === 0;
}

/** Only a published playbook can be deprecated (draft → just delete/ignore it). */
export function canDeprecate(status: PlaybookStatus): boolean {
  return status === "published";
}

// ── Run progress ────────────────────────────────────────────────────────────

/** Mandatory steps still outstanding, in presentation order. */
export function outstandingMandatorySteps(steps: readonly RunStepState[]): RunStepState[] {
  return steps.filter((s) => s.mandatory && s.completedAt === null).sort((a, b) => a.ordinal - b.ordinal);
}

/** A run may be completed only when no mandatory step is outstanding. */
export function canCompleteRun(steps: readonly RunStepState[]): boolean {
  return outstandingMandatorySteps(steps).length === 0;
}

/**
 * Progress as a whole percentage of steps completed.
 *
 * Deliberately never reports 100 unless every step really is done: with plain
 * rounding, 199 of 200 steps rounds to 100% and an agent reading the ticket
 * would believe the playbook was finished. Partial progress therefore floors
 * and caps at 99. A run with no steps is 100 (there is nothing outstanding).
 */
export function computeProgressPct(steps: readonly RunStepState[]): number {
  const total = steps.length;
  if (total === 0) return 100;
  const done = steps.filter((s) => s.completedAt !== null).length;
  if (done >= total) return 100;
  if (done <= 0) return 0;
  return Math.min(99, Math.floor((done / total) * 100));
}

/** The next step an agent should action: lowest-ordinal incomplete step. */
export function nextStep(steps: readonly RunStepState[]): RunStepState | null {
  return [...steps].sort((a, b) => a.ordinal - b.ordinal).find((s) => s.completedAt === null) ?? null;
}

/**
 * When a step is due — run start plus the step's SLA offset. Null when the step
 * is untimed. This is what makes the playbook "SLA-driven": each guided step
 * carries its own internal target inside the ticket's overall SLA.
 */
export function stepDueAt(runStartedAt: Date, slaOffsetMinutes: number | null): Date | null {
  if (slaOffsetMinutes === null) return null;
  return new Date(runStartedAt.getTime() + slaOffsetMinutes * 60_000);
}

/** A step is overdue when its due time has passed and it is not yet complete. */
export function isStepOverdue(
  now: Date,
  runStartedAt: Date,
  slaOffsetMinutes: number | null,
  completedAt: Date | null,
): boolean {
  if (completedAt !== null) return false;
  const due = stepDueAt(runStartedAt, slaOffsetMinutes);
  if (due === null) return false;
  return now.getTime() > due.getTime();
}

/** Steps may only be completed while the run is still in progress. */
export function canCompleteStep(runStatus: RunStatus): boolean {
  return runStatus === "in_progress";
}

/** Build the initial per-step completion state for a fresh run. */
export function initialRunSteps(steps: readonly PlaybookStep[]): RunStepState[] {
  return normaliseSteps(steps).map((s) => ({
    stepId: s.id,
    ordinal: s.ordinal,
    mandatory: s.mandatory,
    completedAt: null,
    completedBy: null,
  }));
}
