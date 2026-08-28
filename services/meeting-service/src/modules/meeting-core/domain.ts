/**
 * meeting-core — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * This module is the single source of truth for the meeting lifecycle state machine and
 * its transition validations. Everything here is deterministic given its inputs (callers
 * inject `now` for time-dependent checks) so the correctness properties exercised in
 * task 3.7 can drive it directly:
 *
 *   P1 Valid transitions only            — `canTransition` / `allowedTargets`
 *   P2 Terminal state reachability       — `isTerminal` / `TERMINAL_STATES` / adjacency
 *   P3 Monotonic progression past approval — `violatesMonotonicApproval` (enforced in `assertTransition`)
 *   P5 Start time recorded               — `stateRequiresActualStart`
 *   P6 Draft-to-scheduled prerequisites  — `validateDraftToScheduled`
 *   P7 Transition audit completeness     — adjacency (one transition = one state change)
 *   P8 Cancelled is terminal             — `isTerminal("cancelled")`
 *
 * Responsibilities (Req 1.1–1.6, 1.8):
 *   - Meeting-state adjacency map + structural transition checks.
 *   - Pure per-transition guard validators (draft→scheduled, →in_progress quorum, adjourn reason).
 *   - Monotonic-past-approval invariant (a meeting never regresses below minutes_approved).
 *   - Tenant-specific custom state-machine overlay (config-driven, Req 1.8) that can add or
 *     block transitions and require extra approvals — but never break the hard invariants
 *     (terminal states stay terminal, monotonic-past-approval always holds).
 *   - Sequential meeting-number generation per committee per financial year.
 *
 * Domain-rule violations are raised as the service's typed `HttpError` via `httpError` so the
 * standard error envelope + HTTP status contract is preserved end-to-end.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_
 */
import { httpError } from "../../shared/context.js";

// ─── Meeting states (Req 1.1) ────────────────────────────────────────────────

/** The ten meeting lifecycle states (Req 1.1). */
export const MEETING_STATES = [
  "draft",
  "scheduled",
  "agenda_locked",
  "in_progress",
  "adjourned",
  "minutes_pending",
  "minutes_approved",
  "closed",
  "archived",
  "cancelled",
] as const;

export type MeetingState = (typeof MEETING_STATES)[number];

/** True if `value` is a recognised meeting state. */
export function isMeetingState(value: string): value is MeetingState {
  return (MEETING_STATES as readonly string[]).includes(value);
}

// ─── State machine adjacency (Req 1.1, 1.6) ──────────────────────────────────

/** A single edge in the state machine: a target state and the action label that drives it. */
export interface TransitionDef {
  to: MeetingState;
  /** Human/audit-facing action name (mirrors the design.md state diagram labels). */
  action: string;
}

/**
 * Base adjacency map, derived exactly from design.md § Meeting Lifecycle State Machine.
 *
 * Notable edges:
 *   - `minutes_pending → minutes_pending` (revise) is an intentional self-loop that
 *     increments the minutes version without changing state.
 *   - `cancelled` and `archived` have no outgoing edges → they are the terminal states.
 *   - `closed → archived` is the only edge out of `closed` (archival after retention check).
 */
const BASE_TRANSITIONS: Record<MeetingState, readonly TransitionDef[]> = {
  draft: [
    { to: "scheduled", action: "schedule" },
    { to: "cancelled", action: "cancel" },
  ],
  scheduled: [
    { to: "agenda_locked", action: "lock_agenda" },
    { to: "cancelled", action: "cancel" },
    { to: "draft", action: "reopen" },
  ],
  agenda_locked: [
    { to: "in_progress", action: "start" },
    { to: "scheduled", action: "unlock" },
    { to: "cancelled", action: "cancel" },
  ],
  in_progress: [
    { to: "adjourned", action: "adjourn" },
    { to: "minutes_pending", action: "end" },
  ],
  adjourned: [
    { to: "in_progress", action: "resume" },
    { to: "minutes_pending", action: "close_without_resume" },
    { to: "cancelled", action: "cancel" },
  ],
  minutes_pending: [
    { to: "minutes_approved", action: "approve_minutes" },
    { to: "minutes_pending", action: "revise" },
  ],
  minutes_approved: [{ to: "closed", action: "close" }],
  closed: [{ to: "archived", action: "archive" }],
  archived: [],
  cancelled: [],
};

/** Terminal states admit no further transitions (Req 1.1, P8). */
export const TERMINAL_STATES: readonly MeetingState[] = MEETING_STATES.filter(
  (s) => BASE_TRANSITIONS[s].length === 0,
);

/** True when `state` has no outgoing transitions (cancelled, archived). */
export function isTerminal(state: MeetingState): boolean {
  return BASE_TRANSITIONS[state].length === 0;
}

// ─── Monotonic progression rank (Req 1.1, P3, P5) ─────────────────────────────

/**
 * Ordinal rank along the linear lifecycle chain, used for the monotonic-past-approval
 * invariant (P3) and the "start recorded" derivation (P5). `cancelled` is intentionally
 * off the linear chain (rank `null`) — it is a terminal branch reachable from several
 * states and is not comparable to progression states.
 */
const STATE_RANK: Record<MeetingState, number | null> = {
  draft: 0,
  scheduled: 1,
  agenda_locked: 2,
  in_progress: 3,
  adjourned: 3,
  minutes_pending: 4,
  minutes_approved: 5,
  closed: 6,
  archived: 7,
  cancelled: null,
};

/** Rank at/after which the meeting has begun; used by P5's actual_start derivation. */
const IN_PROGRESS_RANK = STATE_RANK.in_progress as number;
/** Rank at/after which the minutes are approved; used by P3's monotonic guard. */
const APPROVAL_RANK = STATE_RANK.minutes_approved as number;

/**
 * P5 support: states in which the meeting has started and therefore MUST carry a recorded
 * `actual_start_at` (in_progress and everything downstream on the linear chain). `cancelled`
 * is off-chain and returns false.
 */
export function stateRequiresActualStart(state: MeetingState): boolean {
  const rank = STATE_RANK[state];
  return rank !== null && rank >= IN_PROGRESS_RANK;
}

/**
 * P3 support: a transition violates monotonic-past-approval when it starts at/after
 * `minutes_approved` and targets an earlier linear state. Off-chain targets (`cancelled`)
 * are never a monotonic violation here (they are separately barred once approved by the
 * adjacency map). This guard matters mainly for tenant custom overlays (Req 1.8) that must
 * not be able to introduce a regression below approval.
 */
export function violatesMonotonicApproval(from: MeetingState, to: MeetingState): boolean {
  const fromRank = STATE_RANK[from];
  const toRank = STATE_RANK[to];
  if (fromRank === null || toRank === null) return false;
  return fromRank >= APPROVAL_RANK && toRank < APPROVAL_RANK;
}

// ─── Tenant custom state machine overlay (Req 1.8) ────────────────────────────

/** A directed (from → to) edge used by the tenant overlay to add/block transitions. */
export interface StateEdge {
  from: MeetingState;
  to: MeetingState;
}

/**
 * Tenant-specific state-machine configuration (Req 1.8), typically persisted per tenant and
 * injected by the consumer/routes. The overlay is applied on top of the base machine:
 *   - `additionalTransitions` — extra edges a tenant permits (e.g. a bespoke recall path).
 *   - `blockedTransitions`    — base edges a tenant forbids (e.g. disallow `reopen`).
 *   - `requiredApprovals`     — extra approver roles a tenant mandates for specific edges,
 *                               keyed by `"<from>-><to>"`.
 *
 * Hard invariants are never overridable: an `additionalTransitions` edge that leaves a
 * terminal state or that violates monotonic-past-approval is ignored (defence in depth so a
 * bad tenant config cannot corrupt the lifecycle).
 */
export interface TenantStateMachineConfig {
  additionalTransitions?: readonly StateEdge[];
  blockedTransitions?: readonly StateEdge[];
  requiredApprovals?: Readonly<Record<string, readonly string[]>>;
}

/** Canonical key for an edge in `requiredApprovals` lookups. */
export function transitionKey(from: MeetingState, to: MeetingState): string {
  return `${from}->${to}`;
}

function isEdgeMatch(a: StateEdge, from: MeetingState, to: MeetingState): boolean {
  return a.from === from && a.to === to;
}

/**
 * Compute the effective set of allowed target states from `from`, applying the tenant overlay
 * (Req 1.8) on top of the base adjacency map. Additional edges that would leave a terminal
 * state or violate monotonic-past-approval are rejected; blocked edges are removed.
 */
export function allowedTargets(from: MeetingState, config?: TenantStateMachineConfig): MeetingState[] {
  const targets = new Set<MeetingState>(BASE_TRANSITIONS[from].map((t) => t.to));

  if (config?.additionalTransitions) {
    for (const edge of config.additionalTransitions) {
      if (edge.from !== from) continue;
      if (isTerminal(from)) continue; // terminal stays terminal
      if (violatesMonotonicApproval(from, edge.to)) continue; // never regress past approval
      targets.add(edge.to);
    }
  }
  if (config?.blockedTransitions) {
    for (const edge of config.blockedTransitions) {
      if (edge.from === from) targets.delete(edge.to);
    }
  }
  return [...targets];
}

/**
 * Structural transition check (P1): true IFF `to` is an allowed target from `from` under the
 * (optionally tenant-overlaid) state machine. Does NOT evaluate per-transition data guards
 * (chairperson/agenda/quorum) — use `assertTransition` for the full gate.
 */
export function canTransition(from: MeetingState, to: MeetingState, config?: TenantStateMachineConfig): boolean {
  return allowedTargets(from, config).includes(to);
}

/** Approver roles a tenant mandates for a specific edge (empty when none configured). */
export function requiredApprovalsFor(
  from: MeetingState,
  to: MeetingState,
  config?: TenantStateMachineConfig,
): readonly string[] {
  return config?.requiredApprovals?.[transitionKey(from, to)] ?? [];
}

// ─── Per-transition data guards (Req 1.3, 1.4, 1.5) ───────────────────────────

/** Context supplied to transition validators; callers inject `now` to keep this pure. */
export interface TransitionContext {
  /** Current time, injected for deterministic testing (Req 1.3 future-date check). */
  now: Date;
  /** Assigned chairperson (Req 1.3). */
  chairpersonId?: string | null;
  /** Number of agenda items currently attached (Req 1.3, P6). */
  agendaItemCount?: number;
  /** Scheduled start; must be in the future for draft→scheduled (Req 1.3). */
  scheduledAt?: Date | null;
  /** Whether quorum is established; required for →in_progress (Req 1.4). */
  quorumEstablished?: boolean;
  /** Adjournment reason; required for in_progress→adjourned (Req 1.5). */
  adjournmentReason?: string | null;
  /** Minimum notice period (days) required before a meeting may be scheduled (config-driven, Gap 3). */
  noticePeriodDays?: number | null;
  /** When true, a short-notice scheduling is explicitly waived (recorded on the meeting, Gap 3). */
  shortNoticeWaiver?: boolean;
}

/**
 * Validate the `draft → scheduled` prerequisites (Req 1.3, P6): a chairperson must be
 * assigned, at least one agenda item must exist, and the scheduled date must be in the
 * future. Throws `MEETING_INVALID_TRANSITION` (422) with structured `details` listing the
 * unmet prerequisites; returns void when all hold.
 */
export function validateDraftToScheduled(ctx: TransitionContext): void {
  const unmet: string[] = [];
  if (!ctx.chairpersonId) unmet.push("chairpersonId");
  if (!ctx.agendaItemCount || ctx.agendaItemCount < 1) unmet.push("agendaItem");
  if (!ctx.scheduledAt || ctx.scheduledAt.getTime() <= ctx.now.getTime()) unmet.push("futureScheduledAt");

  if (unmet.length > 0) {
    throw httpError(
      "MEETING_INVALID_TRANSITION",
      "cannot schedule meeting: prerequisites not met (chairperson, >=1 agenda item, future date)",
      { from: "draft", to: "scheduled", unmet },
    );
  }
}

/**
 * Whole days of notice between `now` and the scheduled start (floored, never negative). Used to
 * enforce the statutory minimum notice period and to record `notice_days` on the meeting (Gap 3).
 */
export function computeNoticeDays(now: Date, scheduledAt: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.max(0, Math.floor((scheduledAt.getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * Enforce the minimum notice period on `draft → scheduled` (Gap 3). When the tenant has configured
 * a `noticePeriodDays` and the actual notice falls short, scheduling is REJECTED with
 * `MEETING_SHORT_NOTICE` (422) UNLESS an explicit `shortNoticeWaiver` is supplied — in which case
 * the meeting is scheduled and the waiver is recorded on the row (the consumer sets
 * `short_notice_waived`). A tenant that configures no notice period sees identical behavior.
 */
export function validateNoticePeriod(ctx: TransitionContext): void {
  const required = ctx.noticePeriodDays;
  if (required === undefined || required === null || required <= 0) return;
  if (!ctx.scheduledAt) return; // absence of a scheduled date is caught by validateDraftToScheduled
  const actual = computeNoticeDays(ctx.now, ctx.scheduledAt);
  if (actual < required && !ctx.shortNoticeWaiver) {
    throw httpError(
      "MEETING_SHORT_NOTICE",
      `meeting notice of ${actual} day(s) is less than the required ${required} day(s); a waiver is required`,
      { requiredNoticeDays: required, actualNoticeDays: actual, waiver: false },
    );
  }
}

/**
 * Validate a transition into `in_progress` (Req 1.4): quorum must be established before the
 * meeting may start (or resume). Throws `MEETING_QUORUM_NOT_MET` (422) otherwise.
 */
export function validateQuorumForStart(ctx: TransitionContext): void {
  if (!ctx.quorumEstablished) {
    throw httpError("MEETING_QUORUM_NOT_MET", "quorum must be established before the meeting can start", {
      to: "in_progress",
    });
  }
}

/**
 * Validate an adjournment (Req 1.5): the adjournment reason must be recorded. Throws
 * `MEETING_INVALID_TRANSITION` (422) when missing/blank. The next meeting date and carried-
 * forward items are optional and handled by the consumer.
 */
export function validateAdjourn(ctx: TransitionContext): void {
  if (!ctx.adjournmentReason || ctx.adjournmentReason.trim().length === 0) {
    throw httpError("MEETING_INVALID_TRANSITION", "adjournment requires a recorded reason", {
      from: "in_progress",
      to: "adjourned",
      unmet: ["adjournmentReason"],
    });
  }
}

/**
 * Full transition gate (Req 1.3–1.6, 1.8). Composes the structural check, the monotonic-past-
 * approval invariant (P3), and the relevant per-transition data guards:
 *
 *   1. Structural: `to` must be an allowed target from `from` (tenant overlay applied), else
 *      `MEETING_INVALID_TRANSITION` (422) with the list of allowed targets (Req 1.6).
 *   2. Invariant: never regress below `minutes_approved` (P3).
 *   3. Data guards:
 *        draft → scheduled            → chairperson + agenda + future date (Req 1.3)
 *        * → in_progress              → quorum established (Req 1.4)
 *        in_progress → adjourned      → adjournment reason recorded (Req 1.5)
 *
 * `ctx` is optional for transitions that need no data guard (e.g. cancel, lock_agenda).
 * Returns void on success; the consumer then performs the write + appends the audit log row.
 */
export function assertTransition(
  from: MeetingState,
  to: MeetingState,
  ctx?: TransitionContext,
  config?: TenantStateMachineConfig,
): void {
  if (!canTransition(from, to, config)) {
    const allowed = allowedTargets(from, config);
    throw httpError(
      "MEETING_INVALID_TRANSITION",
      isTerminal(from)
        ? `meeting is in terminal state "${from}"; no transitions are allowed`
        : `cannot transition meeting from "${from}" to "${to}"`,
      { from, to, allowed },
    );
  }

  // Defence in depth: even if a tenant overlay somehow admitted it, never regress past approval.
  if (violatesMonotonicApproval(from, to)) {
    throw httpError("MEETING_INVALID_TRANSITION", `cannot regress from "${from}" to "${to}" after minutes approval`, {
      from,
      to,
    });
  }

  // Per-transition data guards.
  if (from === "draft" && to === "scheduled") {
    const c = requireCtx(ctx, from, to);
    validateDraftToScheduled(c);
    validateNoticePeriod(c);
  }
  if (to === "in_progress") {
    validateQuorumForStart(requireCtx(ctx, from, to));
  }
  if (from === "in_progress" && to === "adjourned") {
    validateAdjourn(requireCtx(ctx, from, to));
  }
}

/** Guarded transitions require a context; missing one is a programmer error surfaced as 400. */
function requireCtx(ctx: TransitionContext | undefined, from: MeetingState, to: MeetingState): TransitionContext {
  if (!ctx) {
    throw httpError("VALIDATION_FAILED", `transition ${from}->${to} requires a transition context`, { from, to });
  }
  return ctx;
}

// ─── Ownership (IDOR fix — Req 1.1, 1.3–1.6) ──────────────────────────────────

/**
 * Committee-member roles that carry secretarial write-standing for a meeting (PATCH), used
 * to extend ownership beyond the single `secretaryId` stamped on the meeting row (e.g. a
 * deputy/co-secretary registered on the committee roster).
 */
export const SECRETARIAL_STANDING_ROLES = ["secretary"] as const;
/** Committee-member roles that carry chair standing for a meeting's transition/cancel authority. */
export const CHAIR_STANDING_ROLES = ["chairperson"] as const;

/**
 * True iff `actorId` is recorded directly on the meeting row as its chairperson or secretary
 * (IDOR fix, Req 1.1: role-only gating previously let ANY `committee_secretary`/
 * `committee_chairperson` in the tenant write/transition ANY meeting). Committee-roster
 * standing (a deputy secretary / co-chair not yet the literal `chairpersonId`/`secretaryId`)
 * is a DB-backed extension layered on top by the caller (`repo.hasCommitteeStanding`) — this
 * pure form only compares what is already loaded on the meeting row.
 */
export function isDirectMeetingOwner(
  actorId: string,
  meeting: { chairpersonId: string | null; secretaryId: string | null },
): boolean {
  return actorId === meeting.chairpersonId || actorId === meeting.secretaryId;
}

// ─── Meeting number generation (Req 1.2) ──────────────────────────────────────

/**
 * Compute the Indian financial year label (April 1 – March 31) for a date, in the canonical
 * 7-char `YYYY-YY` form (matching `meetings.financial_year varchar(7)`), e.g. a date in
 * June 2025 → `"2025-26"`, a date in February 2026 → `"2025-26"`.
 */
export function computeFinancialYear(d: Date): string {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0 = Jan … 3 = Apr
  const startYear = month >= 3 ? year : year - 1;
  const endYY = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYY}`;
}

/**
 * Next sequence number for a committee within a financial year, given the sequences already
 * issued for that (committee, FY) scope. Sequential and gap-tolerant: returns `max + 1`, or
 * `1` when none exist. Callers pass the existing sequences read from the DB under the same
 * (committee, FY) scope; the DB UNIQUE constraint is the ultimate guard against races.
 */
export function nextMeetingSequence(existingSequences: readonly number[]): number {
  let max = 0;
  for (const s of existingSequences) {
    if (Number.isFinite(s) && s > max) max = Math.trunc(s);
  }
  return max + 1;
}

/**
 * Format a sequential meeting number scoped to a committee + financial year (Req 1.2), e.g.
 * `{ committeeCode: "FC", financialYear: "2025-26", sequence: 7 }` → `"FC/2025-26/007"`.
 * Falls back to the `"MTG"` prefix when no committee code is available (ad-hoc meetings).
 */
export function generateMeetingNumber(input: {
  committeeCode?: string | null;
  financialYear: string;
  sequence: number;
}): string {
  const code = (input.committeeCode ?? "").trim().toUpperCase() || "MTG";
  const seq = String(Math.max(1, Math.trunc(input.sequence))).padStart(3, "0");
  return `${code}/${input.financialYear}/${seq}`;
}
