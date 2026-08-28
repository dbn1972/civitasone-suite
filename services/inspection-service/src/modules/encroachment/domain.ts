/**
 * Encroachment domain — pure functions for complaint lifecycle, notice workflow,
 * hearing decisions, and removal state machine.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: BRD 5.19 ENCR-001..004_
 */

// ── Encroachment types ────────────────────────────────────────────────────────

export const ENCROACHMENT_TYPES = [
  "unauthorized_construction",
  "road_encroachment",
  "footpath_occupation",
  "public_land_grab",
  "hawker_zone_violation",
  "drainage_obstruction",
] as const;
export type EncroachmentType = typeof ENCROACHMENT_TYPES[number];

// ── Complaint state machine ───────────────────────────────────────────────────

export const COMPLAINT_STATES = [
  "received",
  "under_verification",
  "verified",
  "notice_issued",
  "hearing_scheduled",
  "hearing_done",
  "removal_ordered",
  "removed",
  "dismissed",
  "appealed",
] as const;
export type ComplaintState = typeof COMPLAINT_STATES[number];

export const COMPLAINT_TRANSITIONS: Record<ComplaintState, ComplaintState[]> = {
  received:            ["under_verification", "dismissed"],
  under_verification:  ["verified", "dismissed"],
  verified:            ["notice_issued", "dismissed"],
  notice_issued:       ["hearing_scheduled"],
  hearing_scheduled:   ["hearing_done"],
  hearing_done:        ["removal_ordered", "dismissed", "appealed"],
  removal_ordered:     ["removed"],
  removed:             [],
  dismissed:           ["appealed"],
  appealed:            [],
};

// ── Notice state machine ──────────────────────────────────────────────────────

export const NOTICE_STATES = [
  "issued",
  "served",
  "response_received",
  "hearing_scheduled",
  "expired",
] as const;
export type NoticeState = typeof NOTICE_STATES[number];

export const NOTICE_TRANSITIONS: Record<NoticeState, NoticeState[]> = {
  issued:             ["served"],
  served:             ["response_received", "expired"],
  response_received:  ["hearing_scheduled"],
  hearing_scheduled:  [],
  expired:            [],
};

// ── Hearing decisions ─────────────────────────────────────────────────────────

export const HEARING_DECISIONS = [
  "removal_ordered",
  "fine_imposed",
  "regularized",
  "dismissed",
  "adjourned",
] as const;
export type HearingDecision = typeof HEARING_DECISIONS[number];

export const HEARING_STATES = ["scheduled", "completed", "adjourned"] as const;
export type HearingState = typeof HEARING_STATES[number];

// ── Removal state machine ─────────────────────────────────────────────────────

export const REMOVAL_STATES = [
  "ordered",
  "team_assigned",
  "in_progress",
  "completed",
  "stayed",
] as const;
export type RemovalState = typeof REMOVAL_STATES[number];

export const REMOVAL_TRANSITIONS: Record<RemovalState, RemovalState[]> = {
  ordered:       ["team_assigned", "stayed"],
  team_assigned: ["in_progress", "stayed"],
  in_progress:   ["completed"],
  completed:     [],
  stayed:        [],
};

// ── Errors ────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure functions ────────────────────────────────────────────────────────────

/**
 * Format a complaint number from a DB-issued sequence value: ENCR-{YYYY}-{SEQ:6}
 *
 * Pure formatter -- the sequence value itself comes from
 * encroachment.complaint_number_seq (see repo.ts's nextComplaintNumber),
 * not from in-process state. Previously this function incremented a
 * module-level counter directly (`let complaintSeq = 0`), which reset to 0
 * on every process restart and was independent per replica in any
 * multi-replica deployment -- two different processes (or the same
 * process before/after a restart) could and did hand out the identical
 * complaint number, and complaint_number had no UNIQUE constraint to
 * catch it. See migration
 * 0028_encroachment_illegal_construction_number_sequences.sql.
 */
export function formatComplaintNumber(seq: number): string {
  const year = new Date().getFullYear();
  return `ENCR-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Format a notice number from a DB-issued sequence value: ENCR-N-{YYYY}-{SEQ:6}
 * Pure formatter -- see formatComplaintNumber's note above; same fix applies.
 */
export function formatNoticeNumber(seq: number): string {
  const year = new Date().getFullYear();
  return `ENCR-N-${year}-${String(seq).padStart(6, "0")}`;
}

/**
 * Assert complaint state transition is valid.
 */
export function assertValidComplaintTransition(
  current: ComplaintState,
  target: ComplaintState,
): void {
  const allowed = COMPLAINT_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition complaint from ${current} to ${target}. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Assert notice state transition is valid.
 */
export function assertValidNoticeTransition(
  current: NoticeState,
  target: NoticeState,
): void {
  const allowed = NOTICE_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition notice from ${current} to ${target}. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Assert removal state transition is valid.
 */
export function assertValidRemovalTransition(
  current: RemovalState,
  target: RemovalState,
): void {
  const allowed = REMOVAL_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition removal from ${current} to ${target}. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Validate verification report structure.
 */
export function validateVerification(report: unknown): void {
  if (!report || typeof report !== "object") {
    throw new DomainError("INVALID_VERIFICATION", "Land verification report must be a non-null object");
  }
}
