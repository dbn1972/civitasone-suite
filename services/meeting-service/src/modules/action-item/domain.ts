/**
 * action-item module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Single source of truth for how the service tracks action items and their follow-up:
 *
 *   - SLA computation (Req 9.1): `computeSlaHours` derives the assignment→deadline window in
 *     whole hours; `deriveDeadlineFromSla` is its inverse for callers that specify an SLA instead
 *     of an explicit deadline.
 *   - Escalation logic (Req 9.5, 9.6, P20): a configurable chain — Level 1 (deadline + 24h →
 *     supervisor), Level 2 (deadline + 72h → department head), Level 3 (deadline + 7d →
 *     chairperson). `computeEscalationLevel` / `resolveEscalationState` derive the current rung
 *     and the next trigger time; `assertEscalationMonotonic` guards P20 (level never decreases).
 *   - Overdue detection (Req 9.5, P21): `isOverdue` — an item is overdue IFF its deadline has
 *     passed AND it is not in a terminal/settled state (completed / verified / withdrawn).
 *   - Evidence-before-verification (Req 9.7, P22): `hasEvidence` / `assertEvidenceBeforeVerification`
 *     — a transition to `verified` requires evidence (URL or note).
 *   - Referential + temporal invariant (Req 9.1, P19): `isDeadlineAfterMeetingStart` /
 *     `assertDeadlineAfterMeetingStart` — an action's deadline must fall after the meeting began.
 *   - ATR generation (Req 10.1–10.4): `classifyAtrItem`, `computeAtrStatistics`,
 *     `computeCompliancePerAssignee`, `compileAtr` — compile open + recently-completed actions
 *     from the committee's last N meetings into a report with summary statistics.
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so the
 * standard error envelope + HTTP status contract is preserved end-to-end. Callers inject `now`
 * so every function is deterministic given its inputs.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
 */
import { httpError } from "../../shared/context.js";

// ─── Domain vocabularies (mirror the migration's VARCHAR value sets) ─────────

/**
 * Action-item lifecycle states (Req 9.2). `assigned` is the initial state; `completed`,
 * `verified` and `withdrawn` are settled states that exclude an item from overdue/escalation.
 */
export const ACTION_ITEM_STATUSES = [
  "assigned",
  "acknowledged",
  "in_progress",
  "evidence_submitted",
  "verified",
  "completed",
  "overdue",
  "escalated",
  "withdrawn",
] as const;
export type ActionItemStatus = (typeof ACTION_ITEM_STATUSES)[number];

/** Action-item priority (Req 9.1). */
export const ACTION_PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type ActionPriority = (typeof ACTION_PRIORITIES)[number];

/**
 * Settled statuses that take an item out of the overdue/escalation flow (Req 9.5, P21). A
 * `verified`/`completed` item has been delivered; a `withdrawn` item was cancelled — none can be
 * "overdue" regardless of the deadline.
 */
export const SETTLED_STATUSES = ["completed", "verified", "withdrawn"] as const;
const SETTLED_STATUS_SET: ReadonlySet<string> = new Set(SETTLED_STATUSES);

/** True when a status is settled (completed / verified / withdrawn). */
export function isSettledStatus(status: string): boolean {
  return SETTLED_STATUS_SET.has(status);
}

// ─── Time constants ──────────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

// ─── SLA computation (Req 9.1) ────────────────────────────────────────────────

/**
 * The SLA window, in whole hours, from when an action is assigned until its deadline (Req 9.1).
 * Rounded to the nearest hour. Returns 0 when the deadline is at or before the assignment instant
 * (a non-positive window is not a valid SLA — callers gate that separately via the temporal
 * invariant / validators), so the stored `sla_hours` is never negative.
 */
export function computeSlaHours(assignedAt: Date, deadline: Date): number {
  const deltaMs = deadline.getTime() - assignedAt.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return Math.round(deltaMs / MS_PER_HOUR);
}

/**
 * Inverse of {@link computeSlaHours}: the deadline implied by assigning an action at `assignedAt`
 * with an `slaHours` window. Used when a caller specifies an SLA instead of an explicit deadline.
 */
export function deriveDeadlineFromSla(assignedAt: Date, slaHours: number): Date {
  const hours = Number.isFinite(slaHours) && slaHours > 0 ? slaHours : 0;
  return new Date(assignedAt.getTime() + hours * MS_PER_HOUR);
}

// ─── Escalation logic (Req 9.5, 9.6 · P20) ─────────────────────────────────────

/** Who a given escalation rung notifies (Req 9.6). */
export type EscalationTarget = "supervisor" | "department_head" | "chairperson";

/** A single rung of the escalation chain: level, offset after the deadline, and notify target. */
export interface EscalationRung {
  level: 1 | 2 | 3;
  /** Hours after the deadline at which this rung fires (Req 9.6). */
  afterDeadlineHours: number;
  notify: EscalationTarget;
}

/**
 * The configurable escalation chain (Req 9.6). Defaults per the requirement:
 *   Level 1 — deadline + 24h  → supervisor
 *   Level 2 — deadline + 72h  → department head
 *   Level 3 — deadline + 7d   → chairperson
 * Kept in ascending offset order; `resolveEscalationState` relies on that ordering.
 */
export const DEFAULT_ESCALATION_CHAIN: readonly EscalationRung[] = [
  { level: 1, afterDeadlineHours: 24, notify: "supervisor" },
  { level: 2, afterDeadlineHours: 72, notify: "department_head" },
  { level: 3, afterDeadlineHours: 24 * 7, notify: "chairperson" },
] as const;

/** The highest escalation level in a chain (0 when the chain is empty). */
export function maxEscalationLevel(chain: readonly EscalationRung[] = DEFAULT_ESCALATION_CHAIN): number {
  return chain.reduce((max, rung) => (rung.level > max ? rung.level : max), 0);
}

/** The notify target for a given escalation level, or `null` if the level is not in the chain. */
export function escalationTarget(
  level: number,
  chain: readonly EscalationRung[] = DEFAULT_ESCALATION_CHAIN,
): EscalationTarget | null {
  return chain.find((rung) => rung.level === level)?.notify ?? null;
}

/**
 * The escalation level an action item should be at, given how far past its deadline `now` is
 * (Req 9.5, 9.6). Returns the highest rung whose `deadline + afterDeadlineHours` has elapsed, or
 * 0 when the deadline has not yet lapsed far enough to trigger the first rung.
 */
export function computeEscalationLevel(
  deadline: Date,
  now: Date,
  chain: readonly EscalationRung[] = DEFAULT_ESCALATION_CHAIN,
): number {
  let level = 0;
  for (const rung of chain) {
    const triggerAt = deadline.getTime() + rung.afterDeadlineHours * MS_PER_HOUR;
    if (now.getTime() >= triggerAt) {
      if (rung.level > level) level = rung.level;
    }
  }
  return level;
}

/**
 * The instant the next escalation rung (after `currentLevel`) will fire, or `null` when the
 * current level is already the top of the chain (Req 9.6). Used to set `next_escalation_at`.
 */
export function nextEscalationAt(
  deadline: Date,
  currentLevel: number,
  chain: readonly EscalationRung[] = DEFAULT_ESCALATION_CHAIN,
): Date | null {
  const next = chain.find((rung) => rung.level > currentLevel);
  if (!next) return null;
  return new Date(deadline.getTime() + next.afterDeadlineHours * MS_PER_HOUR);
}

/** The resolved escalation state for an action item at a point in time. */
export interface EscalationState {
  /** The level the item should now be at (never below `currentLevel` — P20). */
  level: number;
  /** Whether the level advanced from `currentLevel` on this evaluation. */
  escalated: boolean;
  /** Who to notify for the (newly reached) level, or `null` when unchanged / no target. */
  notify: EscalationTarget | null;
  /** When the following rung fires, or `null` at the top of the chain. */
  nextEscalationAt: Date | null;
}

/**
 * Resolve the escalation state for an overdue action item (Req 9.5, 9.6, P20).
 *
 * The target level is `max(currentLevel, computeEscalationLevel(...))` so escalation is strictly
 * monotonic — it can only climb, never regress (P20), even if `now` or the chain change. When the
 * level advances, `notify` names the target for the newly reached rung; `nextEscalationAt` always
 * points at the following (unfired) rung.
 */
export function resolveEscalationState(input: {
  deadline: Date;
  currentLevel: number;
  now: Date;
  chain?: readonly EscalationRung[];
}): EscalationState {
  const chain = input.chain ?? DEFAULT_ESCALATION_CHAIN;
  const current = Number.isFinite(input.currentLevel) && input.currentLevel > 0 ? Math.trunc(input.currentLevel) : 0;
  const computed = computeEscalationLevel(input.deadline, input.now, chain);
  const level = Math.max(current, computed);
  const escalated = level > current;
  return {
    level,
    escalated,
    notify: escalated ? escalationTarget(level, chain) : null,
    nextEscalationAt: nextEscalationAt(input.deadline, level, chain),
  };
}

/**
 * Guard P20 (escalation monotonicity): an action item's escalation level may only increase.
 * Throws `VALIDATION_FAILED` (400) when a caller attempts to lower it.
 */
export function assertEscalationMonotonic(fromLevel: number, toLevel: number): void {
  if (toLevel < fromLevel) {
    throw httpError("VALIDATION_FAILED", "escalation level cannot decrease", { fromLevel, toLevel });
  }
}

// ─── Overdue detection (Req 9.5 · P21) ─────────────────────────────────────────

/**
 * P21 — an action item is overdue IFF its `deadline` has passed (`deadline < now`) AND it is not
 * in a settled state (completed / verified / withdrawn). Pure predicate: the persisted `status`
 * value is a separate concern from this derivation.
 */
export function isOverdue(input: { deadline: Date; status: string; now: Date }): boolean {
  if (isSettledStatus(input.status)) return false;
  return input.deadline.getTime() < input.now.getTime();
}

/**
 * The status an item should hold after an overdue sweep (Req 9.5). A non-settled item whose
 * deadline has lapsed becomes `overdue` (unless it has already advanced to `escalated`, which is
 * preserved); otherwise the current status is unchanged. Settled items are always left as-is.
 */
export function resolveOverdueStatus(input: {
  deadline: Date;
  status: ActionItemStatus;
  now: Date;
}): ActionItemStatus {
  if (!isOverdue(input)) return input.status;
  if (input.status === "escalated") return "escalated";
  return "overdue";
}

// ─── Evidence before verification (Req 9.7 · P22) ──────────────────────────────

/** True when an action item carries completion evidence — a URL or a free-text note (P22). */
export function hasEvidence(item: { evidenceUrl?: string | null; evidenceNote?: string | null }): boolean {
  return Boolean(item.evidenceUrl && item.evidenceUrl.trim()) || Boolean(item.evidenceNote && item.evidenceNote.trim());
}

/**
 * Guard P22: a transition to `verified` requires evidence (URL or note) to be present (Req 9.7).
 * Throws `VALIDATION_FAILED` (400) when neither is supplied.
 */
export function assertEvidenceBeforeVerification(item: {
  evidenceUrl?: string | null;
  evidenceNote?: string | null;
}): void {
  if (!hasEvidence(item)) {
    throw httpError("VALIDATION_FAILED", "verification requires completion evidence (url or note)", {});
  }
}

// ─── Referential + temporal invariant (Req 9.1 · P19) ──────────────────────────

/**
 * P19 — an action item's `deadline` must fall strictly after the meeting actually started
 * (`meeting.actual_start_at`). When the meeting has no recorded start (not yet in progress) the
 * invariant is vacuously satisfied — there is no anchor to compare against.
 */
export function isDeadlineAfterMeetingStart(deadline: Date, actualStartAt: Date | null | undefined): boolean {
  if (!actualStartAt) return true;
  return deadline.getTime() > actualStartAt.getTime();
}

/**
 * Assert P19 (Req 9.1): the action's deadline is after the meeting start. Throws
 * `ACTION_ITEM_DEADLINE_INVALID` (422) with both instants when the deadline is at or before the
 * meeting start — a business-rule violation of the referential+temporal invariant, not a bare
 * shape error, so it carries its own domain code rather than the generic `VALIDATION_FAILED`.
 */
export function assertDeadlineAfterMeetingStart(deadline: Date, actualStartAt: Date | null | undefined): void {
  if (!isDeadlineAfterMeetingStart(deadline, actualStartAt)) {
    throw httpError("ACTION_ITEM_DEADLINE_INVALID", "action item deadline must be after the meeting start", {
      deadline: deadline.toISOString(),
      actualStartAt: actualStartAt ? actualStartAt.toISOString() : null,
    });
  }
}

// ─── ATR generation (Req 10.1–10.4) ────────────────────────────────────────────

/** Default number of prior committee meetings an ATR draws from (Req 10.1). */
export const DEFAULT_ATR_MEETING_WINDOW = 3;

/** Committee ATR compliance floor; two consecutive breaches escalate (Req 10.5). */
export const ATR_COMPLIANCE_FLOOR_PCT = 70;

/** Outcome bucket an action item falls into for ATR statistics (Req 10.4). */
export type AtrOutcome = "completed_on_time" | "completed_late" | "overdue" | "withdrawn" | "pending";

/** The subset of an action item the ATR classification/statistics need. */
export interface AtrActionItem {
  status: string;
  deadline: Date;
  completedAt?: Date | null;
}

/**
 * Classify an action item into its ATR outcome bucket (Req 10.4):
 *   - `withdrawn`          — the action was cancelled.
 *   - `completed_on_time`  — completed/verified with completion at or before the deadline.
 *   - `completed_late`     — completed/verified after the deadline.
 *   - `overdue`            — not settled and past deadline (see {@link isOverdue}).
 *   - `pending`            — not settled and not yet overdue (open, in progress).
 *
 * A completed item with no recorded `completedAt` is treated as on-time (nothing indicates a
 * breach).
 */
export function classifyAtrItem(item: AtrActionItem, now: Date): AtrOutcome {
  if (item.status === "withdrawn") return "withdrawn";
  if (item.status === "completed" || item.status === "verified") {
    if (item.completedAt && item.completedAt.getTime() > item.deadline.getTime()) return "completed_late";
    return "completed_on_time";
  }
  if (isOverdue({ deadline: item.deadline, status: item.status, now })) return "overdue";
  return "pending";
}

/** ATR summary statistics for a set of action items (Req 10.4). */
export interface AtrStatistics {
  total: number;
  completedOnTime: number;
  completedLate: number;
  overdue: number;
  withdrawn: number;
  pending: number;
  /**
   * Compliance percentage (0–100) = on-time completions ÷ total, rounded to the nearest percent.
   * Late completions are counted as completed but do NOT count toward compliance (Req 10.4, 10.5).
   * An empty set reports 0.
   */
  compliancePct: number;
}

/** Compute ATR summary statistics over a set of action items (Req 10.4). */
export function computeAtrStatistics(items: readonly AtrActionItem[], now: Date): AtrStatistics {
  const stats: AtrStatistics = {
    total: items.length,
    completedOnTime: 0,
    completedLate: 0,
    overdue: 0,
    withdrawn: 0,
    pending: 0,
    compliancePct: 0,
  };
  for (const item of items) {
    switch (classifyAtrItem(item, now)) {
      case "completed_on_time":
        stats.completedOnTime += 1;
        break;
      case "completed_late":
        stats.completedLate += 1;
        break;
      case "overdue":
        stats.overdue += 1;
        break;
      case "withdrawn":
        stats.withdrawn += 1;
        break;
      case "pending":
        stats.pending += 1;
        break;
    }
  }
  stats.compliancePct = stats.total > 0 ? Math.round((stats.completedOnTime * 100) / stats.total) : 0;
  return stats;
}

/** Per-assignee compliance breakdown (Req 10.4: "percentage compliance per assignee"). */
export interface AssigneeCompliance {
  assigneeId: string;
  total: number;
  completedOnTime: number;
  completedLate: number;
  overdue: number;
  withdrawn: number;
  pending: number;
  compliancePct: number;
}

/**
 * Compute per-assignee ATR compliance (Req 10.4). Groups items by `assigneeId` and computes the
 * same statistics per group. Results are ordered by assignee id for deterministic output.
 */
export function computeCompliancePerAssignee(
  items: readonly (AtrActionItem & { assigneeId: string })[],
  now: Date,
): AssigneeCompliance[] {
  const byAssignee = new Map<string, AtrActionItem[]>();
  for (const item of items) {
    const list = byAssignee.get(item.assigneeId) ?? [];
    list.push(item);
    byAssignee.set(item.assigneeId, list);
  }
  const out: AssigneeCompliance[] = [];
  for (const [assigneeId, group] of byAssignee) {
    const s = computeAtrStatistics(group, now);
    out.push({
      assigneeId,
      total: s.total,
      completedOnTime: s.completedOnTime,
      completedLate: s.completedLate,
      overdue: s.overdue,
      withdrawn: s.withdrawn,
      pending: s.pending,
      compliancePct: s.compliancePct,
    });
  }
  out.sort((a, b) => (a.assigneeId < b.assigneeId ? -1 : a.assigneeId > b.assigneeId ? 1 : 0));
  return out;
}

/** Whole days an item is overdue at `now` (Req 10.2), rounded up; 0 when it is not overdue. */
export function daysOverdue(item: AtrActionItem, now: Date): number {
  if (!isOverdue({ deadline: item.deadline, status: item.status, now })) return 0;
  return Math.ceil((now.getTime() - item.deadline.getTime()) / MS_PER_DAY);
}

/** One row of a compiled ATR (Req 10.2): the columns an ATR presents per action item. */
export interface AtrEntry {
  actionItemId: string;
  agendaItemRef: string | null;
  description: string;
  assigneeId: string;
  originalDeadline: string;
  currentStatus: string;
  outcome: AtrOutcome;
  evidenceSummary: string | null;
  daysOverdue: number;
}

/** The full action-item shape an ATR row is compiled from. */
export interface AtrSourceItem extends AtrActionItem {
  id: string;
  agendaItemId?: string | null;
  description: string;
  assigneeId: string;
  evidenceUrl?: string | null;
  evidenceNote?: string | null;
}

/**
 * True when an item belongs in an ATR (Req 10.1): all open items, plus recently-completed ones.
 * "Open" = not settled; a completed/verified item is included only if it settled within
 * `recentlyCompletedDays` of `now` (default: the full report window is applied by the caller when
 * selecting meetings, so completions surface as "recently completed"). Withdrawn items are
 * included so the report shows cancellations.
 */
export function isAtrIncludable(
  item: AtrActionItem,
  now: Date,
  recentlyCompletedDays = 90,
): boolean {
  if (item.status === "completed" || item.status === "verified") {
    if (!item.completedAt) return true;
    return now.getTime() - item.completedAt.getTime() <= recentlyCompletedDays * MS_PER_DAY;
  }
  return true;
}

/** A compiled Action Taken Report (Req 10.1, 10.2, 10.4). */
export interface CompiledAtr {
  entries: AtrEntry[];
  statistics: AtrStatistics;
  perAssignee: AssigneeCompliance[];
  /** True when overall compliance is below the configured floor (Req 10.5). */
  belowComplianceFloor: boolean;
}

/**
 * Compile an ATR from a committee's action items (Req 10.1–10.4). Produces one entry per item
 * (ordered by original deadline, then id, for a stable report), the overall summary statistics,
 * the per-assignee compliance breakdown, and a flag for the sub-70% compliance escalation (Req
 * 10.5). Pure — the repo supplies the pre-selected items (last N meetings) and `now`.
 */
export function compileAtr(items: readonly AtrSourceItem[], now: Date): CompiledAtr {
  const entries: AtrEntry[] = items.map((item) => ({
    actionItemId: item.id,
    agendaItemRef: item.agendaItemId ?? null,
    description: item.description,
    assigneeId: item.assigneeId,
    originalDeadline: item.deadline.toISOString(),
    currentStatus: item.status,
    outcome: classifyAtrItem(item, now),
    evidenceSummary: summariseEvidence(item),
    daysOverdue: daysOverdue(item, now),
  }));
  entries.sort((a, b) => {
    if (a.originalDeadline !== b.originalDeadline) return a.originalDeadline < b.originalDeadline ? -1 : 1;
    return a.actionItemId < b.actionItemId ? -1 : a.actionItemId > b.actionItemId ? 1 : 0;
  });
  const statistics = computeAtrStatistics(items, now);
  const perAssignee = computeCompliancePerAssignee(items, now);
  return {
    entries,
    statistics,
    perAssignee,
    belowComplianceFloor: statistics.total > 0 && statistics.compliancePct < ATR_COMPLIANCE_FLOOR_PCT,
  };
}

/** A short evidence summary for an ATR row (Req 10.2): the note, else the URL, else null. */
function summariseEvidence(item: { evidenceNote?: string | null; evidenceUrl?: string | null }): string | null {
  const note = item.evidenceNote?.trim();
  if (note) return note;
  const url = item.evidenceUrl?.trim();
  if (url) return url;
  return null;
}
