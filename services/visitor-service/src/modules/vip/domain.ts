/**
 * visitor-service: vip — pure domain logic (no DB, no I/O).
 *
 * Owns:
 *   - VIP privilege resolution: dedicated parking, escort assignment (from
 *     a caller-supplied duty roster), and fast-track flag for a given
 *     visitor category (Requirement 21.1). VIP category always carries all
 *     three privileges; non-VIP categories carry none.
 *   - Escort assignment: picks the first available officer from the duty
 *     roster when escort is required (Requirement 21.5). Pure function —
 *     the roster itself is loaded by the caller (repo.ts) from the duty
 *     roster source (hrms-service or a local `escort_officers` config).
 *   - Role-gating predicate for the VIP log query, restricted to
 *     `protocol_officer` / `security_admin` (Requirement 21.4). Exposed as
 *     a pure predicate (`canViewVipLog`) plus a throwing assertion
 *     (`assertCanViewVipLog`) so routes.ts (task 17.2) can either call the
 *     assertion directly or compose it with the existing `requireRole`
 *     pattern from `src/shared/context.ts`.
 */
import type { VisitorCategory } from "../visit-request/domain.js";

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ---------------------------------------------------------------------------
// VIP privilege resolution (Requirement 21.1)
// ---------------------------------------------------------------------------

/**
 * A single entry in the security/protocol duty roster available for VIP
 * escort assignment. `available` reflects the officer's current on-duty /
 * unassigned status at resolution time.
 */
export interface DutyRosterEntry {
  employeeId: string;
  name: string;
  available: boolean;
}

/**
 * The set of VIP privileges resolved for a given visit request. A `null`
 * `escortEmployeeId` means either escort was not required for this visit,
 * or escort was required but no roster entry was available (the caller
 * should surface this as an unassigned-escort condition rather than fail
 * the visit request).
 */
export interface VipPrivileges {
  dedicatedParking: boolean;
  fastTrack: boolean;
  escortEmployeeId: string | null;
}

/** True only for the "vip" visitor category. */
export function isVipCategory(category: VisitorCategory | string): boolean {
  return category === "vip";
}

/**
 * Picks the first available duty-roster entry for VIP escort assignment.
 * Returns `null` when the roster is empty or no entry is currently
 * available (Requirement 21.5).
 */
export function assignEscort(dutyRoster: readonly DutyRosterEntry[]): string | null {
  const entry = dutyRoster.find((candidate) => candidate.available);
  return entry ? entry.employeeId : null;
}

/**
 * Resolves the full set of VIP privileges for a visit request.
 *
 * - Non-VIP categories always resolve to no privileges at all, regardless
 *   of `escortRequired` or the duty roster contents.
 * - VIP category always resolves `dedicatedParking: true` and
 *   `fastTrack: true` (Requirement 21.1).
 * - Escort is only assigned when `escortRequired` is true for this
 *   location/area (Requirement 21.5); otherwise `escortEmployeeId` is
 *   `null` even for a VIP visit.
 */
export function resolveVipPrivileges(
  category: VisitorCategory | string,
  escortRequired: boolean,
  dutyRoster: readonly DutyRosterEntry[],
): VipPrivileges {
  if (!isVipCategory(category)) {
    return { dedicatedParking: false, fastTrack: false, escortEmployeeId: null };
  }

  return {
    dedicatedParking: true,
    fastTrack: true,
    escortEmployeeId: escortRequired ? assignEscort(dutyRoster) : null,
  };
}

// ---------------------------------------------------------------------------
// VIP log role gating (Requirement 21.4)
// ---------------------------------------------------------------------------

/** The only two roles permitted to query the separate VIP visitor log. */
export const VIP_LOG_ALLOWED_ROLES = ["protocol_officer", "security_admin"] as const;

/**
 * Pure predicate: true when `roles` contains at least one of
 * `VIP_LOG_ALLOWED_ROLES`. Kept dependency-free (no Fastify request, no
 * `RequestContext`) so it is directly unit-testable and reusable from
 * routes.ts (task 17.2) alongside — or instead of — `requireRole`.
 */
export function canViewVipLog(roles: readonly string[]): boolean {
  return roles.some((role) => (VIP_LOG_ALLOWED_ROLES as readonly string[]).includes(role));
}

/** Throwing variant of {@link canViewVipLog}. Maps to a 403 at the route layer. */
export function assertCanViewVipLog(roles: readonly string[]): void {
  if (!canViewVipLog(roles)) {
    throw new DomainError("FORBIDDEN", `VIP log access requires one of: ${VIP_LOG_ALLOWED_ROLES.join(", ")}`);
  }
}
