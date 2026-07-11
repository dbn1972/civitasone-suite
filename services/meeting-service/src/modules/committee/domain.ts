/**
 * committee module — pure domain logic (no I/O, fully unit/property testable).
 *
 * Covers:
 *   • Quorum rule evaluation — absolute count OR percentage OR role composition,
 *     with VC-attendance inclusion controlled by `vcCountsForQuorum` (Req 2.3, 2.6).
 *   • Tenure validation — membership validity + expiry window (Req 2.4).
 *   • Membership status transitions — active/suspended/expired/resigned/removed (Req 2.2).
 *
 * These functions are the source of truth for the committee correctness properties
 * exercised in task 4.4:
 *   P9  Quorum count correctness  — `evaluateQuorum().countSatisfied`
 *   P10 Membership validity       — `isMembershipValid`
 *   P12 Quorum composition        — `evaluateQuorum().compositionSatisfied`
 *   P13 VC quorum exclusion       — `countQuorumEligible` (honours vcCountsForQuorum)
 *
 * All date inputs are ISO `YYYY-MM-DD` strings (matching the `date` columns). Date-only
 * lexicographic comparison is exact for this canonical format, so no timezone handling
 * is needed here — the domain stays deterministic and pure.
 */

/** Typed domain error (mirrors sibling modules); routes/consumer map `code` to HTTP. */
export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ─── Enumerations ─────────────────────────────────────────────────────────────

/** Committee body type (Req 2.1). */
export type CommitteeType = "standing" | "ad_hoc" | "statutory" | "board";
export const COMMITTEE_TYPES: readonly CommitteeType[] = ["standing", "ad_hoc", "statutory", "board"];

/** Member role within a committee (Req 2.2). */
export type MemberRole = "chairperson" | "member" | "secretary" | "special_invitee";
export const MEMBER_ROLES: readonly MemberRole[] = ["chairperson", "member", "secretary", "special_invitee"];

/** Committee-level voting rule (majority rule applied to its resolutions). */
export type VotingRule = "simple_majority" | "two_thirds" | "three_fourths" | "unanimous";
export const VOTING_RULES: readonly VotingRule[] = ["simple_majority", "two_thirds", "three_fourths", "unanimous"];

/** Statutory meeting-frequency obligation (Req 2.5). */
export type MeetingFrequency = "weekly" | "fortnightly" | "monthly" | "quarterly" | "half_yearly" | "annual" | "ad_hoc";
export const MEETING_FREQUENCIES: readonly MeetingFrequency[] = [
  "weekly", "fortnightly", "monthly", "quarterly", "half_yearly", "annual", "ad_hoc",
];

/** Committee lifecycle status. */
export type CommitteeStatus = "active" | "dissolved" | "superseded";

/** Membership lifecycle status. */
export type MembershipStatus = "active" | "suspended" | "expired" | "resigned" | "removed";
export const MEMBERSHIP_STATUSES: readonly MembershipStatus[] = [
  "active", "suspended", "expired", "resigned", "removed",
];

// ─── Quorum rule model ─────────────────────────────────────────────────────────

/**
 * Minimum per-role attendance counts, e.g. `{ special_invitee: 0, member: 3 }` or the
 * common "at least one external member" rule. Keys are member roles; values are the
 * minimum number of quorum-eligible attendees holding that role.
 */
export type RoleComposition = Record<string, number>;

/**
 * Persisted committee quorum rule (`committees.quorum_rule` JSONB, Req 2.3).
 *
 * A rule expresses the minimum required attendance as an absolute count (`minMembers`)
 * and/or a percentage of the active roster (`minPercentage`). When both are present the
 * STRICTER (larger) resulting count applies. `roleComposition` adds an independent
 * per-role floor that must ALSO be met. `vcCountsForQuorum` decides whether attendees
 * joining over video-conference count toward quorum (Req 2.3, P13).
 */
export interface QuorumRule {
  minMembers?: number;
  minPercentage?: number;
  roleComposition?: RoleComposition;
  vcCountsForQuorum: boolean;
}

/** A single attendee as seen by quorum evaluation. */
export interface QuorumAttendee {
  /** Attendance status; only `present`/`joined_late` count toward quorum. */
  status: string;
  /** Attendance mode; `vc` may be excluded when `vcCountsForQuorum === false`. */
  mode: string;
  /** Member role, used only when `roleComposition` is configured. */
  role?: string;
}

/** Attendance statuses that count as "in the room" for quorum. */
const PRESENT_STATUSES = new Set(["present", "joined_late"]);
const VC_MODE = "vc";

/** Result of evaluating a quorum rule against a live attendance set. */
export interface QuorumEvaluation {
  /** True IFF both the count constraint AND (if any) the composition constraint hold. */
  established: boolean;
  /** Number of quorum-eligible attendees actually counted (after VC exclusion). */
  countedAttendees: number;
  /** Absolute minimum members required, derived from minMembers/minPercentage. */
  requiredMembers: number;
  /** True IFF `countedAttendees >= requiredMembers`. */
  countSatisfied: boolean;
  /** True IFF every configured role floor is met (trivially true when none configured). */
  compositionSatisfied: boolean;
  /** Per-role shortfall (required minus actual) for roles that fell short; empty when satisfied. */
  compositionShortfall: Record<string, number>;
}

/**
 * Validate a quorum rule's internal consistency (used by validators + consumer before
 * persisting). Throws `DomainError("COMMITTEE_QUORUM_RULE_INVALID", …)` on violation.
 *
 * A rule MUST specify at least one of `minMembers` / `minPercentage`. Counts must be
 * positive; percentage must be within 1..100; role-composition floors must be
 * non-negative integers.
 */
export function assertValidQuorumRule(rule: QuorumRule): void {
  const hasAbsolute = rule.minMembers !== undefined;
  const hasPercentage = rule.minPercentage !== undefined;
  if (!hasAbsolute && !hasPercentage) {
    throw new DomainError(
      "COMMITTEE_QUORUM_RULE_INVALID",
      "quorum rule must specify minMembers and/or minPercentage",
    );
  }
  if (hasAbsolute && (!Number.isInteger(rule.minMembers) || (rule.minMembers as number) < 1)) {
    throw new DomainError("COMMITTEE_QUORUM_RULE_INVALID", "minMembers must be a positive integer");
  }
  if (hasPercentage) {
    const p = rule.minPercentage as number;
    if (!Number.isInteger(p) || p < 1 || p > 100) {
      throw new DomainError("COMMITTEE_QUORUM_RULE_INVALID", "minPercentage must be an integer in 1..100");
    }
  }
  if (rule.roleComposition) {
    for (const [role, min] of Object.entries(rule.roleComposition)) {
      if (!Number.isInteger(min) || min < 0) {
        throw new DomainError(
          "COMMITTEE_QUORUM_RULE_INVALID",
          `roleComposition["${role}"] must be a non-negative integer`,
        );
      }
    }
  }
}

/**
 * Absolute minimum members required by the rule for a roster of `totalActiveMembers`.
 * When both `minMembers` and `minPercentage` are set, the stricter (larger) applies.
 * The percentage floor rounds UP (a quorum can never be a fractional member).
 */
export function requiredQuorumCount(rule: QuorumRule, totalActiveMembers: number): number {
  const candidates: number[] = [];
  if (rule.minMembers !== undefined) candidates.push(rule.minMembers);
  if (rule.minPercentage !== undefined) {
    candidates.push(Math.ceil((rule.minPercentage / 100) * Math.max(0, totalActiveMembers)));
  }
  return candidates.length > 0 ? Math.max(...candidates) : 0;
}

/**
 * Count quorum-eligible attendees (P9 + P13): attendees whose status is present or
 * joined_late, excluding VC-mode attendees when `rule.vcCountsForQuorum === false`.
 */
export function countQuorumEligible(attendees: readonly QuorumAttendee[], rule: QuorumRule): number {
  return attendees.filter((a) => isQuorumEligible(a, rule)).length;
}

/** True if a single attendee counts toward quorum under the given rule. */
function isQuorumEligible(a: QuorumAttendee, rule: QuorumRule): boolean {
  if (!PRESENT_STATUSES.has(a.status)) return false;
  if (!rule.vcCountsForQuorum && a.mode === VC_MODE) return false;
  return true;
}

/**
 * Evaluate whether quorum is established for a live attendance set (P9, P12, P13).
 *
 * `totalActiveMembers` is the active roster size, needed only to resolve a
 * percentage-based `minMembers`. Quorum is established IFF the counted eligible
 * attendees meet the required minimum AND every configured per-role floor is met.
 */
export function evaluateQuorum(
  attendees: readonly QuorumAttendee[],
  rule: QuorumRule,
  totalActiveMembers: number,
): QuorumEvaluation {
  const eligible = attendees.filter((a) => isQuorumEligible(a, rule));
  const countedAttendees = eligible.length;
  const requiredMembers = requiredQuorumCount(rule, totalActiveMembers);
  const countSatisfied = countedAttendees >= requiredMembers;

  const compositionShortfall: Record<string, number> = {};
  if (rule.roleComposition) {
    for (const [role, min] of Object.entries(rule.roleComposition)) {
      if (min <= 0) continue;
      const actual = eligible.filter((a) => a.role === role).length;
      if (actual < min) compositionShortfall[role] = min - actual;
    }
  }
  const compositionSatisfied = Object.keys(compositionShortfall).length === 0;

  return {
    established: countSatisfied && compositionSatisfied,
    countedAttendees,
    requiredMembers,
    countSatisfied,
    compositionSatisfied,
    compositionShortfall,
  };
}

// ─── Tenure validation ─────────────────────────────────────────────────────────

/** A membership as seen by tenure checks (subset of committee_members columns). */
export interface MembershipTenure {
  appointmentDate: string; // ISO YYYY-MM-DD
  tenureEnd: string | null; // ISO YYYY-MM-DD or null (open-ended)
  status: string;
}

/**
 * Membership validity (P10): a member is validly serving on `asOf` IFF the appointment
 * date has arrived AND the tenure has not ended. Open-ended tenure (`tenureEnd === null`)
 * never expires. Comparison is inclusive on both bounds.
 */
export function isMembershipValid(member: MembershipTenure, asOf: string): boolean {
  if (member.appointmentDate > asOf) return false;
  if (member.tenureEnd !== null && member.tenureEnd < asOf) return false;
  return true;
}

/** True if `tenureEnd` is set and strictly before `asOf` (tenure has lapsed). */
export function isTenureExpired(tenureEnd: string | null, asOf: string): boolean {
  return tenureEnd !== null && tenureEnd < asOf;
}

/**
 * Whole days from `asOf` until `tenureEnd`. Negative if already past, `null` for
 * open-ended tenure. Uses UTC midnight of each date so DST never skews the count.
 */
export function daysUntilTenureEnd(tenureEnd: string | null, asOf: string): number | null {
  if (tenureEnd === null) return null;
  const MS_PER_DAY = 86_400_000;
  const end = Date.parse(`${tenureEnd}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  return Math.round((end - now) / MS_PER_DAY);
}

/**
 * Tenure-expiry window (P11, Req 2.4): true when the member's tenure ends within
 * `withinDays` (default 30) on or after `asOf` — i.e. `0 <= daysUntilTenureEnd <= withinDays`.
 * Already-expired tenures are excluded (they are handled by expiry, not advance notice).
 */
export function isTenureExpiring(tenureEnd: string | null, asOf: string, withinDays = 30): boolean {
  const days = daysUntilTenureEnd(tenureEnd, asOf);
  if (days === null) return false;
  return days >= 0 && days <= withinDays;
}

// ─── Membership status transitions ───────────────────────────────────────────

/**
 * Allowed membership status transitions. `active`/`suspended` are live states;
 * `expired`/`resigned`/`removed` are terminal (a fresh appointment is a new row, not a
 * re-transition). A suspended member can be reinstated to active.
 */
const MEMBERSHIP_TRANSITIONS: Record<MembershipStatus, readonly MembershipStatus[]> = {
  active:    ["suspended", "expired", "resigned", "removed"],
  suspended: ["active", "expired", "resigned", "removed"],
  expired:   [],
  resigned:  [],
  removed:   [],
};

/** True if `from` is a recognised membership status. */
export function isMembershipStatus(value: string): value is MembershipStatus {
  return (MEMBERSHIP_STATUSES as readonly string[]).includes(value);
}

/** True if a membership may transition from `from` to `to`. */
export function canTransitionMembership(from: MembershipStatus, to: MembershipStatus): boolean {
  return MEMBERSHIP_TRANSITIONS[from].includes(to);
}

/** Terminal membership states admit no further transitions. */
export function isTerminalMembershipStatus(status: MembershipStatus): boolean {
  return MEMBERSHIP_TRANSITIONS[status].length === 0;
}

/**
 * Assert a membership status transition is legal, else throw
 * `DomainError("COMMITTEE_MEMBERSHIP_INVALID_TRANSITION", …)` listing allowed targets.
 */
export function assertMembershipTransition(from: MembershipStatus, to: MembershipStatus): void {
  if (from === to) {
    throw new DomainError(
      "COMMITTEE_MEMBERSHIP_INVALID_TRANSITION",
      `membership already in status "${from}"`,
    );
  }
  if (!canTransitionMembership(from, to)) {
    const allowed = MEMBERSHIP_TRANSITIONS[from];
    const detail = allowed.length > 0 ? allowed.join(", ") : "(none — terminal)";
    throw new DomainError(
      "COMMITTEE_MEMBERSHIP_INVALID_TRANSITION",
      `cannot transition membership from "${from}" to "${to}"; allowed: ${detail}`,
    );
  }
}
