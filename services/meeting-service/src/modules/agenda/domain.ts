/**
 * Agenda module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Responsibilities (Req 3.1–3.7):
 *   - Canonical agenda ordering: standing → arising_from_minutes → new_business, stable within group.
 *   - Reorder to a contiguous 1..N bijection (P26) that is idempotent under re-application (P27).
 *   - Submission-deadline enforcement (configurable, default 7 days before the meeting).
 *   - Duration-overrun warning (accepted items exceed the scheduled meeting time by > 15%).
 *   - Carry-forward of deferred items to the next meeting of the same committee.
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so
 * the standard error envelope + HTTP status contract is preserved end-to-end. These functions
 * remain pure: they perform no I/O and are deterministic given their inputs (callers inject
 * `now` for time-dependent checks).
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
 */
import { httpError } from "../../shared/context.js";
import { TERMINAL_STATES } from "../meeting-core/domain.js";

// ─── Domain vocabularies (mirror the migration CHECK-able value sets) ────────

/** Expected outcome of discussing an agenda item (Req 3.1). */
export const AGENDA_OUTCOME_TYPES = ["decision", "discussion", "information", "ratification"] as const;
export type AgendaOutcomeType = (typeof AGENDA_OUTCOME_TYPES)[number];

/** Agenda item lifecycle states (Req 3.2). */
export const AGENDA_STATUSES = ["proposed", "accepted", "deferred", "withdrawn", "carried_forward"] as const;
export type AgendaStatus = (typeof AGENDA_STATUSES)[number];

/**
 * Ordering categories (Req 3.3). Ordinal order encodes the mandated grouping:
 * standing items first, items arising from previous minutes second, new business third.
 */
export const AGENDA_CATEGORIES = ["standing", "arising_from_minutes", "new_business"] as const;
export type AgendaCategory = (typeof AGENDA_CATEGORIES)[number];

/** 5-level confidentiality model shared across the service. */
export const CONFIDENTIALITY_LEVELS = ["public", "internal", "confidential", "secret", "top_secret"] as const;
export type ConfidentialityLevel = (typeof CONFIDENTIALITY_LEVELS)[number];

/** Rank used to sort categories; unknown/absent categories fall into new_business (last). */
const CATEGORY_RANK: Record<AgendaCategory, number> = {
  standing: 0,
  arising_from_minutes: 1,
  new_business: 2,
};

function categoryRank(category: string | null | undefined): number {
  if (category && category in CATEGORY_RANK) {
    return CATEGORY_RANK[category as AgendaCategory];
  }
  return CATEGORY_RANK.new_business;
}

// ─── Configuration ───────────────────────────────────────────────────────────

/** Tenant/committee-configurable agenda knobs. All fields optional; defaults applied per-field. */
export interface AgendaConfig {
  /** Days before the meeting after which proposals need chairperson approval (Req 3.5). */
  submissionDeadlineDays?: number;
  /** Percentage over the scheduled meeting duration that triggers a warning (Req 3.7). */
  durationOverrunThresholdPct?: number;
}

/** Default: proposals close 7 days before the meeting (Req 3.5). */
export const DEFAULT_SUBMISSION_DEADLINE_DAYS = 7;
/** Default: warn when accepted items exceed the scheduled duration by more than 15% (Req 3.7). */
export const DEFAULT_DURATION_OVERRUN_THRESHOLD_PCT = 15;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function resolveDeadlineDays(config?: AgendaConfig): number {
  const d = config?.submissionDeadlineDays;
  return typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : DEFAULT_SUBMISSION_DEADLINE_DAYS;
}

function resolveOverrunThresholdPct(config?: AgendaConfig): number {
  const p = config?.durationOverrunThresholdPct;
  return typeof p === "number" && Number.isFinite(p) && p >= 0 ? p : DEFAULT_DURATION_OVERRUN_THRESHOLD_PCT;
}

// ─── Ordering (Req 3.3) ────────────────────────────────────────────────────────

/** Minimal shape needed to order an agenda item; the real row is a superset. */
export interface OrderableAgendaItem {
  id: string;
  category?: string | null;
  /** Existing sequence, used as a stable tie-breaker within a category group. */
  sequence?: number | null;
}

/**
 * Assign a canonical, contiguous 1..N `sequence` to `items`.
 *
 * Grouping order: standing → arising_from_minutes → new_business (Req 3.3). Ordering is
 * STABLE within each group: items keep their relative order, tie-broken by existing
 * `sequence` (nulls last) then by original array position, so re-running on an already
 * ordered list is a no-op. Guarantees a gap-free, duplicate-free 1..N sequence (P26).
 */
export function orderAgendaItems<T extends OrderableAgendaItem>(items: readonly T[]): Array<T & { sequence: number }> {
  const decorated = items.map((item, index) => ({ item, index }));
  decorated.sort((a, b) => {
    const rankDiff = categoryRank(a.item.category) - categoryRank(b.item.category);
    if (rankDiff !== 0) return rankDiff;
    const aSeq = a.item.sequence ?? Number.POSITIVE_INFINITY;
    const bSeq = b.item.sequence ?? Number.POSITIVE_INFINITY;
    if (aSeq !== bSeq) return aSeq - bSeq;
    return a.index - b.index; // stable fallback
  });
  return decorated.map(({ item }, i) => ({ ...item, sequence: i + 1 }));
}

// ─── Reorder (Req 3.4 · P26 · P27) ──────────────────────────────────────────────

/** A single entry in an explicit reorder request: an item mapped to its target sequence. */
export interface ReorderEntry {
  agendaItemId: string;
  sequence: number;
}

/**
 * Validate that a reorder payload is a 1..N bijection over the item ids:
 *   - every `agendaItemId` is distinct (no id assigned two sequences), and
 *   - the multiset of sequences equals exactly {1, 2, …, N} (no gaps, no duplicates).
 *
 * Throws `VALIDATION_FAILED` (400) with structured details otherwise. Enforcing this at the
 * boundary is what makes the persisted ordering satisfy the contiguous-sequence invariant (P26).
 */
export function validateReorderBijection(order: readonly ReorderEntry[]): void {
  const n = order.length;
  const ids = new Set<string>();
  const seqs = new Set<number>();
  for (const entry of order) {
    if (ids.has(entry.agendaItemId)) {
      throw httpError("VALIDATION_FAILED", "duplicate agendaItemId in reorder payload", {
        agendaItemId: entry.agendaItemId,
      });
    }
    ids.add(entry.agendaItemId);
    if (!Number.isInteger(entry.sequence) || entry.sequence < 1 || entry.sequence > n) {
      throw httpError("VALIDATION_FAILED", "reorder sequence must be an integer in 1..N", {
        agendaItemId: entry.agendaItemId,
        sequence: entry.sequence,
        n,
      });
    }
    if (seqs.has(entry.sequence)) {
      throw httpError("VALIDATION_FAILED", "duplicate sequence in reorder payload", { sequence: entry.sequence });
    }
    seqs.add(entry.sequence);
  }
  // With N distinct integers each in 1..N and no duplicates, the set is exactly {1..N}.
}

/**
 * Normalise a validated reorder request into the canonical id→sequence assignment.
 *
 * The result is sorted by requested sequence and re-numbered 1..N. This is IDEMPOTENT: feeding
 * the output back in yields an identical mapping, so applying the same reorder twice equals
 * applying it once (P27). Callers should `validateReorderBijection` first.
 */
export function applyReorder(order: readonly ReorderEntry[]): ReorderEntry[] {
  return [...order]
    .sort((a, b) => a.sequence - b.sequence)
    .map((entry, i) => ({ agendaItemId: entry.agendaItemId, sequence: i + 1 }));
}

// ─── Lock enforcement (Req 3.4) ──────────────────────────────────────────────

/**
 * Guard structural agenda mutations (add / reorder) against a locked OR terminal meeting.
 * Once a meeting reaches `agenda_locked`, only an explicit chairperson unlock re-opens it
 * (Req 3.4). Once a meeting reaches a TERMINAL state — meeting-core's `TERMINAL_STATES`
 * (`cancelled`, `archived`) — its agenda can never be mutated again either: previously this
 * checked only the single literal `"agenda_locked"`, so a `cancelled` meeting's agenda stayed
 * fully editable forever (the bug this fix closes). Throws `MEETING_AGENDA_LOCKED` (422) in
 * both cases.
 */
export function assertAgendaNotLocked(meetingStatus: string): void {
  if (meetingStatus === "agenda_locked" || (TERMINAL_STATES as readonly string[]).includes(meetingStatus)) {
    throw httpError("MEETING_AGENDA_LOCKED", "agenda is locked or the meeting is in a terminal state; cannot modify", {
      meetingStatus,
    });
  }
}

// ─── Submission deadline (Req 3.5) ────────────────────────────────────────────

/** Compute the submission cut-off = scheduledAt − deadlineDays. */
export function computeSubmissionDeadline(scheduledAt: Date, config?: AgendaConfig): Date {
  const days = resolveDeadlineDays(config);
  return new Date(scheduledAt.getTime() - days * MS_PER_DAY);
}

/** True when `now` is at/after the submission cut-off for a meeting scheduled at `scheduledAt`. */
export function isPastSubmissionDeadline(scheduledAt: Date, now: Date, config?: AgendaConfig): boolean {
  return now.getTime() >= computeSubmissionDeadline(scheduledAt, config).getTime();
}

/**
 * Enforce the submission deadline for a new agenda-item proposal (Req 3.5). Submissions after
 * the cut-off are allowed ONLY with explicit chairperson approval; otherwise this throws
 * `MEETING_PAST_DEADLINE` (422). A meeting with no `scheduledAt` yet (still draft) has no
 * deadline and always passes.
 */
export function assertSubmissionAllowed(opts: {
  scheduledAt: Date | null | undefined;
  now: Date;
  isChairpersonApproved?: boolean;
  config?: AgendaConfig;
}): void {
  const { scheduledAt, now, isChairpersonApproved = false, config } = opts;
  if (!scheduledAt) return;
  if (isChairpersonApproved) return;
  if (isPastSubmissionDeadline(scheduledAt, now, config)) {
    throw httpError("MEETING_PAST_DEADLINE", "agenda submission deadline has passed; chairperson approval required", {
      deadline: computeSubmissionDeadline(scheduledAt, config).toISOString(),
      scheduledAt: scheduledAt.toISOString(),
    });
  }
}

// ─── Duration overrun (Req 3.7) ───────────────────────────────────────────────

/** Result of an agenda-vs-meeting duration comparison. */
export interface DurationOverrun {
  /** Sum of accepted items' estimated durations (minutes). */
  totalMinutes: number;
  /** The meeting's scheduled duration (minutes). */
  scheduledMinutes: number;
  /** Minutes over the scheduled duration (0 when within budget). */
  overByMinutes: number;
  /** Percentage over the scheduled duration (0 when within budget or scheduled ≤ 0). */
  overByPct: number;
  /** True when the overrun exceeds the configured threshold (default 15%). */
  warn: boolean;
}

/** Minimal shape needed to sum agenda duration. */
export interface DurationCountableItem {
  status?: string | null;
  durationMinutes?: number | null;
}

/**
 * Compute total estimated duration of ACCEPTED agenda items against the scheduled meeting
 * duration and flag a warning when the total exceeds it by more than the configured threshold
 * (default 15%, Req 3.7). Only `accepted` items count toward the budget.
 */
export function computeDurationOverrun(
  items: readonly DurationCountableItem[],
  scheduledMinutes: number,
  config?: AgendaConfig,
): DurationOverrun {
  const thresholdPct = resolveOverrunThresholdPct(config);
  const totalMinutes = items
    .filter((it) => it.status === "accepted")
    .reduce((sum, it) => sum + Math.max(0, it.durationMinutes ?? 0), 0);

  const scheduled = Math.max(0, scheduledMinutes);
  const overByMinutes = Math.max(0, totalMinutes - scheduled);
  const overByPct = scheduled > 0 ? (overByMinutes / scheduled) * 100 : 0;
  const warn = scheduled > 0 && overByPct > thresholdPct;

  return { totalMinutes, scheduledMinutes: scheduled, overByMinutes, overByPct, warn };
}

// ─── Carry-forward (Req 3.6) ──────────────────────────────────────────────────

/** The subset of a source agenda item needed to build its carry-forward successor. */
export interface CarryForwardSource {
  id: string;
  tenantId: string;
  title: string;
  description?: string | null;
  outcomeType: string;
  durationMinutes?: number | null;
  presenterId?: string | null;
  confidentialityLevel?: string | null;
  category?: string | null;
  linkedDecisionId?: string | null;
  fileReference?: string | null;
}

/** A carry-forward plan: the new item to insert on the next meeting + the source status update. */
export interface CarryForwardPlan {
  /** New agenda item for the next meeting (status carried_forward). `sequence` assigned on order. */
  next: {
    tenantId: string;
    meetingId: string;
    title: string;
    description: string | null;
    outcomeType: string;
    durationMinutes: number;
    presenterId: string | null;
    confidentialityLevel: string;
    category: string | null;
    linkedDecisionId: string | null;
    fileReference: string | null;
    status: "carried_forward";
    createdBy: string;
    updatedBy: string;
  };
  /** How to update the source item: mark deferred (Req 3.6). `deferredTo` linked once the new id exists. */
  sourceUpdate: {
    id: string;
    status: "deferred";
  };
}

/**
 * Build the carry-forward plan for a deferred agenda item (Req 3.6): a new `carried_forward`
 * item cloned onto the next scheduled meeting of the same committee, plus the update marking the
 * source item `deferred`. Pure — the consumer persists both parts in one transaction and links
 * `source.deferredTo` to the newly-inserted id.
 */
export function buildCarryForward(
  source: CarryForwardSource,
  opts: { nextMeetingId: string; actorId: string },
): CarryForwardPlan {
  return {
    next: {
      tenantId: source.tenantId,
      meetingId: opts.nextMeetingId,
      title: source.title,
      description: source.description ?? null,
      outcomeType: source.outcomeType,
      durationMinutes: source.durationMinutes ?? 15,
      presenterId: source.presenterId ?? null,
      confidentialityLevel: source.confidentialityLevel ?? "internal",
      category: source.category ?? null,
      linkedDecisionId: source.linkedDecisionId ?? null,
      fileReference: source.fileReference ?? null,
      status: "carried_forward",
      createdBy: opts.actorId,
      updatedBy: opts.actorId,
    },
    sourceUpdate: { id: source.id, status: "deferred" },
  };
}
