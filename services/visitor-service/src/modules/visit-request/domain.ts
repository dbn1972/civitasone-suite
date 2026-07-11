/**
 * visitor-service: visit-request — pure domain logic (no DB, no I/O).
 *
 * Owns:
 *   - Visit-date validation window (1h-30d from now) — Property 1.
 *   - Required-field validation for visit request submission — Property 3.
 *   - Visit_Request status state machine (pending_approval/pre_approved ->
 *     approved/rejected/auto_rejected/cancelled, plus approved -> no_show)
 *     — Property 6.
 *   - Initial-status resolution: host pre-registration bypass (Property 4)
 *     and VIP category bypass (Property 27).
 *   - Auto-reject-after-24h and reminder-after-4h due-checks — Property 7,
 *     Requirements 3.4/3.5.
 *   - Human-readable tracking-reference generation (Requirement 1.1).
 */
import { randomInt } from "node:crypto";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * Property 3: Required Fields Validation. Thrown with the full set of
 * missing field names so the route layer can build a field-level
 * validation error response.
 */
export class ValidationError extends DomainError {
  constructor(public readonly fields: string[]) {
    super("VALIDATION_ERROR", `missing required field(s): ${fields.join(", ")}`);
  }
}

// ---------------------------------------------------------------------------
// Property 1: Visit Date Validation Window
// ---------------------------------------------------------------------------

/** Minimum lead time: a visit must be scheduled at least 1 hour out. */
export const MIN_SCHEDULE_LEAD_MS = 60 * 60 * 1000;
/** Maximum lead time: a visit must be scheduled at most 30 days out. */
export const MAX_SCHEDULE_LEAD_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Property 1: accepts scheduledAt values at least 1 hour and at most 30
 * days ahead of `now`; rejects all others (including past dates). `now`
 * defaults to the current time but is injectable for deterministic tests.
 */
export function isValidScheduledDate(scheduledAt: Date, now: Date = new Date()): boolean {
  const leadMs = scheduledAt.getTime() - now.getTime();
  return leadMs >= MIN_SCHEDULE_LEAD_MS && leadMs <= MAX_SCHEDULE_LEAD_MS;
}

/** Throwing variant of {@link isValidScheduledDate}. Maps to a 422 at the route layer. */
export function assertValidScheduledDate(scheduledAt: Date, now: Date = new Date()): void {
  if (!isValidScheduledDate(scheduledAt, now)) {
    throw new DomainError(
      "INVALID_SCHEDULED_DATE",
      `scheduledAt must be between 1 hour and 30 days from now, got ${scheduledAt.toISOString()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Property 3: Required Fields Validation
// ---------------------------------------------------------------------------

/**
 * The subset of visit-request fields required at submission time. Field
 * names mirror the Drizzle columns in schema.ts (visitorName, visitorPhone,
 * purpose, hostEmployeeId, scheduledAt, identityDocRef) so the missing-field
 * list can be surfaced directly to API consumers.
 */
export interface VisitRequestFieldInput {
  visitorName?: string | null;
  visitorPhone?: string | null;
  purpose?: string | null;
  hostEmployeeId?: string | null;
  scheduledAt?: Date | null;
  identityDocRef?: string | null;
}

const REQUIRED_STRING_FIELDS = ["visitorName", "visitorPhone", "purpose", "hostEmployeeId", "identityDocRef"] as const;

/**
 * Property 3: for any payload missing one or more of name, phone, purpose,
 * host, date, or identity document, returns the list of missing field
 * names (empty array when all required fields are present).
 */
export function findMissingRequiredFields(input: VisitRequestFieldInput): string[] {
  const missing: string[] = [];

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = input[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      missing.push(field);
    }
  }

  if (!input.scheduledAt) {
    missing.push("scheduledAt");
  }

  return missing;
}

/** Throwing variant of {@link findMissingRequiredFields}. Maps to a 400 at the route layer. */
export function assertRequiredFields(input: VisitRequestFieldInput): void {
  const missing = findMissingRequiredFields(input);
  if (missing.length > 0) {
    throw new ValidationError(missing);
  }
}

// ---------------------------------------------------------------------------
// Property 6: Approval State Transition (state machine)
// ---------------------------------------------------------------------------

/**
 * Visit_Request lifecycle.
 *   pending_approval — awaiting host (or workflow) decision.
 *   pre_approved      — created via host pre-registration; skips the queue.
 *   approved          — host/workflow approved; triggers pass generation.
 *   rejected          — host rejected, with a stored reason.
 *   auto_rejected     — pending_approval for >24h, auto-rejected by the
 *                       scheduled job (Property 7).
 *   cancelled         — withdrawn by host or visitor before check-in.
 *   no_show           — approved but visitor never arrived (Requirement 16.4).
 */
export type VisitRequestStatus =
  | "pending_approval"
  | "pre_approved"
  | "approved"
  | "rejected"
  | "auto_rejected"
  | "cancelled"
  | "no_show";

export const ALLOWED_TRANSITIONS: Record<VisitRequestStatus, readonly VisitRequestStatus[]> = {
  pending_approval: ["approved", "rejected", "auto_rejected", "cancelled"],
  pre_approved: ["approved", "rejected", "auto_rejected", "cancelled"],
  approved: ["cancelled", "no_show"],
  rejected: [],
  auto_rejected: [],
  cancelled: [],
  no_show: [],
};

export function assertTransitionAllowed(from: string, to: VisitRequestStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from as VisitRequestStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `visit request cannot transition from '${from}' to '${to}'`);
  }
}

/** Property 6: pending_approval (or pre_approved) -> approved. */
export function approve(from: string): VisitRequestStatus {
  assertTransitionAllowed(from, "approved");
  return "approved";
}

/**
 * Property 6: pending_approval (or pre_approved) -> rejected, storing the
 * given reason. A blank reason is rejected — Requirement 3.3 requires the
 * rejection reason to be recorded.
 */
export function reject(from: string, reason: string): { status: VisitRequestStatus; rejectionReason: string } {
  if (!reason || reason.trim().length === 0) {
    throw new DomainError("VALIDATION_ERROR", "rejection reason is required");
  }
  assertTransitionAllowed(from, "rejected");
  return { status: "rejected", rejectionReason: reason };
}

// ---------------------------------------------------------------------------
// Properties 4 & 27: initial-status resolution (bypass rules)
// ---------------------------------------------------------------------------

export type VisitRequestSource = "portal" | "host_preregister" | "kiosk" | "mobile";
export type VisitorCategory = "standard" | "vip" | "contractor" | "delegation";

/**
 * Resolves the initial status for a newly-submitted visit request.
 *
 * - Property 27: visitor_category = "vip" always bypasses the approval
 *   queue entirely, going straight to `approved` so a Digital_Pass can be
 *   issued immediately upon host confirmation (Requirement 21.2). VIP takes
 *   priority over source.
 * - Property 4: source = "host_preregister" always yields `pre_approved`,
 *   never `pending_approval` (Requirement 2.1).
 * - All other combinations enter the standard `pending_approval` queue.
 */
export function resolveInitialStatus(source: VisitRequestSource, visitorCategory: VisitorCategory): VisitRequestStatus {
  if (visitorCategory === "vip") {
    return "approved";
  }
  if (source === "host_preregister") {
    return "pre_approved";
  }
  return "pending_approval";
}

// ---------------------------------------------------------------------------
// Property 7 & Requirement 3.4: auto-reject / reminder due-checks
// ---------------------------------------------------------------------------

/** Auto-reject threshold: 24 hours in `pending_approval` (Property 7, Requirement 3.5). */
export const AUTO_REJECT_AFTER_MS = 24 * 60 * 60 * 1000;
/** Host reminder threshold: 4 hours in `pending_approval` (Requirement 3.4). */
export const REMINDER_AFTER_MS = 4 * 60 * 60 * 1000;

/**
 * Property 7: true once a `pending_approval` request has been open for
 * strictly more than 24 hours. Caller is responsible for only invoking
 * this for requests currently in `pending_approval` state.
 */
export function isAutoRejectDue(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > AUTO_REJECT_AFTER_MS;
}

/**
 * Requirement 3.4: true once a `pending_approval` request has been open
 * for strictly more than 4 hours (used by the reminder scheduled task,
 * task 6.12).
 */
export function isReminderDue(createdAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - createdAt.getTime() > REMINDER_AFTER_MS;
}

// ---------------------------------------------------------------------------
// Tracking reference generator
// ---------------------------------------------------------------------------

/** Excludes visually ambiguous characters (0/O, 1/I/L). */
const TRACKING_REF_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const TRACKING_REF_LENGTH = 8;

/**
 * Generates a short, human-readable tracking reference (8 uppercase
 * alphanumeric characters, ambiguity-free alphabet) acknowledged to the
 * visitor at submission time (Requirement 1.1). Fits within the
 * `tracking_ref varchar(12)` column.
 */
export function generateTrackingRef(): string {
  let ref = "";
  for (let i = 0; i < TRACKING_REF_LENGTH; i++) {
    ref += TRACKING_REF_ALPHABET[randomInt(TRACKING_REF_ALPHABET.length)];
  }
  return ref;
}
