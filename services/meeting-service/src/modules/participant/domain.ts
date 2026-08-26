/**
 * Participant module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Responsibilities (Req 5.1–5.7):
 *   - Role assignment validation: the recognised participant roles and which roles count
 *     toward quorum (Req 5.1).
 *   - RSVP response handling: map accept/tentative/decline to the stored invitation status
 *     and enforce that a decline always carries a reason (Req 5.2, 5.6).
 *   - Quorum computation: real-time confirmed-vs-threshold tally over invitation responses,
 *     surfacing the shortfall used for the 48-hour under-quorum alert (Req 5.3, 5.4).
 *   - Proxy/nominee logic: validate a designated nominee against the committee's approved
 *     nominee list, reject self-nomination, and gate which roles may nominate (Req 5.5).
 *   - Special-invitee item scoping: a special invitee is restricted to the specific agenda
 *     items they were invited for (Req 5.7).
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so the
 * standard error envelope + HTTP status contract is preserved end-to-end. These functions remain
 * pure and deterministic given their inputs.
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
 */
import { httpError } from "../../shared/context.js";

// ─── Self-or-standing check (IDOR fix, Req 5.2, 5.5, 5.6) ─────────────────────

/**
 * True iff `actorId` may RSVP/nominate on behalf of the participant identified by
 * `participantEmployeeId`. `routes.ts`'s own doc comment states the intended model — "the
 * invited member acts on their own invitation" — but the route never checked it (any
 * `committee_member` in the tenant could respond/nominate for a stranger). Two ways to pass:
 *   1. Self: `actorId === participantEmployeeId` — the invitee acting for themselves.
 *   2. On-behalf-of: `actorId` is recorded as the MEETING's own chairperson or secretary.
 *      `participant/routes.ts` already deliberately admits `committee_secretary` /
 *      `committee_chairperson` / admins alongside `committee_member` into
 *      `MEMBER_ACTION_ROLES` for these two endpoints (RBAC doc comment: "members + chairperson
 *      + secretariat + admins) may call these") — real-world precedent for a secretariat
 *      recording an RSVP received by phone/paper on behalf of a member. This on-behalf-of
 *      branch is grounded in DB-verifiable meeting ownership (not a bare role claim) so it
 *      stays meaningful even where role information is unavailable (the consumer — see
 *      `consumer.ts`'s `assertCanActOnParticipant`, which additionally allows committee-roster
 *      chair/secretary standing, not just the meeting's own stamped `chairpersonId`/
 *      `secretaryId`).
 * A `null` `meeting` (defensive; should not happen once the parent-existence guard has run)
 * falls through to self-only.
 */
export function canActOnParticipant(
  actorId: string,
  participantEmployeeId: string,
  meeting: { chairpersonId: string | null; secretaryId: string | null } | null,
): boolean {
  if (actorId === participantEmployeeId) return true;
  if (!meeting) return false;
  return actorId === meeting.chairpersonId || actorId === meeting.secretaryId;
}

// ─── Domain vocabularies (mirror the migration value sets) ───────────────────

/** Participant role within a meeting (Req 5.1). */
export const PARTICIPANT_ROLES = [
  "chairperson",
  "member",
  "secretary",
  "special_invitee",
  "observer",
  "presenter",
] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/** Invitation lifecycle status stored on the participant row (Req 5.2, 5.3, 5.6). */
export const INVITATION_STATUSES = ["pending", "accepted", "tentative", "declined"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** RSVP action a participant submits; maps to an `InvitationStatus` (Req 5.2). */
export const RSVP_RESPONSES = ["accept", "tentative", "decline"] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

/** How a participant attends when present. */
export const ATTENDANCE_MODES = ["in_person", "vc"] as const;
export type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

/**
 * Roles that count toward quorum (Req 5.3). Quorum is a floor on *members* of the body:
 * the chairperson and members. Secretary, special invitees, observers and presenters attend
 * but do not contribute to the quorum count.
 */
const QUORUM_COUNTING_ROLES = new Set<ParticipantRole>(["chairperson", "member"]);

/**
 * Roles permitted to designate a proxy/nominee (Req 5.5). Only quorum-bearing members
 * (chairperson, member) may send an alternate; observers/presenters/secretary/special
 * invitees cannot nominate.
 */
const PROXY_ELIGIBLE_ROLES = new Set<ParticipantRole>(["chairperson", "member"]);

// ─── Role assignment validation (Req 5.1) ────────────────────────────────────

/** Type guard: is `value` a recognised participant role? */
export function isParticipantRole(value: string): value is ParticipantRole {
  return (PARTICIPANT_ROLES as readonly string[]).includes(value);
}

/** True if the given role contributes to the quorum count (Req 5.3). */
export function isQuorumCountingRole(role: string): boolean {
  return isParticipantRole(role) && QUORUM_COUNTING_ROLES.has(role);
}

/**
 * Assert a role is valid and that its role-specific invariants hold (Req 5.1, 5.7):
 *   - `role` must be one of `PARTICIPANT_ROLES`.
 *   - a `special_invitee` MUST be scoped to at least one agenda item (`agendaItemIds`), since
 *     their access is restricted to those items (Req 5.7); scoping is meaningless for other
 *     roles and must not be supplied.
 *
 * Throws `VALIDATION_FAILED` (400) on any violation.
 */
export function assertValidRoleAssignment(opts: {
  role: string;
  agendaItemIds?: readonly string[] | null;
}): void {
  const { role, agendaItemIds } = opts;
  if (!isParticipantRole(role)) {
    throw httpError("VALIDATION_FAILED", `unknown participant role "${role}"`, {
      role,
      allowed: [...PARTICIPANT_ROLES],
    });
  }
  const hasItemScope = Array.isArray(agendaItemIds) && agendaItemIds.length > 0;
  if (role === "special_invitee" && !hasItemScope) {
    throw httpError("VALIDATION_FAILED", "special_invitee must be scoped to at least one agenda item", {
      role,
    });
  }
  if (role !== "special_invitee" && hasItemScope) {
    throw httpError("VALIDATION_FAILED", "agenda item scoping is only valid for a special_invitee", {
      role,
    });
  }
}

// ─── RSVP response handling (Req 5.2, 5.6) ────────────────────────────────────

/** Map an RSVP action to the invitation status it records. */
export function responseToStatus(response: RsvpResponse): InvitationStatus {
  switch (response) {
    case "accept":
      return "accepted";
    case "tentative":
      return "tentative";
    case "decline":
      return "declined";
  }
}

/**
 * Validate an RSVP submission (Req 5.2, 5.6). A `decline` MUST carry a non-empty reason so the
 * secretary can weigh rescheduling; accept/tentative must NOT carry a decline reason. Returns the
 * resolved `InvitationStatus`. Throws `VALIDATION_FAILED` (400) on violation.
 */
export function resolveRsvp(opts: { response: RsvpResponse; declineReason?: string | null }): InvitationStatus {
  const { response } = opts;
  const reason = opts.declineReason?.trim();
  if (response === "decline") {
    if (!reason) {
      throw httpError("VALIDATION_FAILED", "a decline response requires a reason", { response });
    }
  } else if (reason) {
    throw httpError("VALIDATION_FAILED", "declineReason is only valid with a decline response", { response });
  }
  return responseToStatus(response);
}

// ─── Quorum computation: confirmed vs threshold (Req 5.3, 5.4) ────────────────

/** Minimal participant shape needed to tally invitation responses. */
export interface ResponderView {
  role: string;
  invitationStatus: string;
}

/** Real-time breakdown of invitation responses against the quorum threshold (Req 5.3, 5.4). */
export interface QuorumConfirmation {
  /** Quorum threshold (minimum quorum-counting confirmations required). */
  threshold: number;
  /** Quorum-counting participants who have `accepted` (confirmed attendance). */
  confirmedCount: number;
  /** Quorum-counting participants still `tentative`. */
  tentativeCount: number;
  /** Quorum-counting participants who have `declined`. */
  declinedCount: number;
  /** Quorum-counting participants who have not yet responded (`pending`). */
  pendingCount: number;
  /** True IFF `confirmedCount >= threshold`. */
  met: boolean;
  /** Members short of the threshold: `max(0, threshold - confirmedCount)`. */
  shortfall: number;
}

/**
 * Compute the confirmation tally against the quorum threshold (Req 5.3), counting only
 * quorum-bearing roles (chairperson, member). The `shortfall` and `met` flag drive the
 * 48-hour under-quorum alert (Req 5.4): when `!met`, the caller alerts secretary + chairperson.
 *
 * A negative `threshold` is clamped to 0. Pure and deterministic.
 */
export function computeQuorumConfirmation(
  participants: readonly ResponderView[],
  threshold: number,
): QuorumConfirmation {
  const safeThreshold = Math.max(0, Math.floor(threshold));
  let confirmedCount = 0;
  let tentativeCount = 0;
  let declinedCount = 0;
  let pendingCount = 0;

  for (const p of participants) {
    if (!isQuorumCountingRole(p.role)) continue;
    switch (p.invitationStatus) {
      case "accepted":
        confirmedCount += 1;
        break;
      case "tentative":
        tentativeCount += 1;
        break;
      case "declined":
        declinedCount += 1;
        break;
      case "pending":
        pendingCount += 1;
        break;
      default:
        break;
    }
  }

  const met = confirmedCount >= safeThreshold;
  return {
    threshold: safeThreshold,
    confirmedCount,
    tentativeCount,
    declinedCount,
    pendingCount,
    met,
    shortfall: met ? 0 : safeThreshold - confirmedCount,
  };
}

// ─── Proxy / nominee logic (Req 5.5) ──────────────────────────────────────────

/**
 * Validate a proxy/nominee designation (Req 5.5):
 *   - only quorum-bearing roles (chairperson, member) may nominate a proxy — others cannot
 *     (`VALIDATION_FAILED`, 400);
 *   - a member cannot nominate themselves (`VALIDATION_FAILED`, 400);
 *   - the nominee MUST appear in the committee's approved nominee list
 *     (`PARTICIPANT_NOT_MEMBER`, 422).
 *
 * `approvedNomineeIds` is the committee-maintained roster of permissible alternates. Pure.
 */
export function assertNomineeAllowed(opts: {
  participantRole: string;
  participantEmployeeId: string;
  nomineeId: string;
  approvedNomineeIds: readonly string[];
}): void {
  const { participantRole, participantEmployeeId, nomineeId, approvedNomineeIds } = opts;

  if (!isParticipantRole(participantRole) || !PROXY_ELIGIBLE_ROLES.has(participantRole)) {
    throw httpError("VALIDATION_FAILED", `role "${participantRole}" may not designate a proxy`, {
      role: participantRole,
      allowed: [...PROXY_ELIGIBLE_ROLES],
    });
  }
  if (nomineeId === participantEmployeeId) {
    throw httpError("VALIDATION_FAILED", "a member cannot nominate themselves as proxy", { nomineeId });
  }
  if (!approvedNomineeIds.includes(nomineeId)) {
    throw httpError("PARTICIPANT_NOT_MEMBER", "nominee is not in the approved nominee list", { nomineeId });
  }
}

// ─── Special-invitee item scoping (Req 5.7) ───────────────────────────────────

/** Minimal shape needed to evaluate item-level access. */
export interface ItemScopedParticipant {
  role: string;
  agendaItemIds?: readonly string[] | null;
}

/**
 * Whether a participant may access a given agenda item (Req 5.7). A `special_invitee` is
 * restricted to the specific items in their `agendaItemIds` scope; every other role has
 * unrestricted access to the meeting's items. A special invitee with no scope can access
 * nothing (their invitation is meaningless without at least one item — enforced on add).
 */
export function canAccessAgendaItem(participant: ItemScopedParticipant, agendaItemId: string): boolean {
  if (participant.role !== "special_invitee") return true;
  const scope = participant.agendaItemIds;
  return Array.isArray(scope) && scope.includes(agendaItemId);
}
