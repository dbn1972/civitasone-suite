/**
 * Pure rules for platform-operator management (GAP-ADMIN-OPERATORS-05).
 *
 * A platform operator is an active holder of a platform-authority role. Changes to
 * an operator are REQUESTS that a different active super_admin approves
 * (maker != checker). Two protections apply at every step and again inside the
 * approving transaction: nobody acts on themselves, and the last active
 * super_admin can be neither suspended nor demoted.
 */

export const PLATFORM_ROLE_KEYS = ["super_admin", "platform_admin"] as const;
export type PlatformRoleKey = (typeof PLATFORM_ROLE_KEYS)[number];
/** Only a super_admin may approve or reject (VERIFY: a platform_admin can request but not decide). */
export const APPROVER_ROLE_KEY: PlatformRoleKey = "super_admin";

export const REQUEST_KINDS = ["suspend", "reactivate", "role_change", "grant"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled" | "refused";

export function isPlatformRoleKey(k: string): k is PlatformRoleKey {
  return (PLATFORM_ROLE_KEYS as readonly string[]).includes(k);
}

/** The role shown for an operator who holds several: super_admin outranks platform_admin. */
export function primaryRoleKey(keys: readonly string[]): PlatformRoleKey | null {
  if (keys.includes("super_admin")) return "super_admin";
  if (keys.includes("platform_admin")) return "platform_admin";
  return null;
}

export type RefusalCode =
  | "SELF_ACTION"
  | "NOT_AN_OPERATOR"
  | "ALREADY_PENDING"
  | "INVALID_STATE"
  | "INVALID_ROLE"
  | "LAST_SUPER_ADMIN";

export const REFUSAL_MESSAGE: Record<RefusalCode, string> = {
  SELF_ACTION: "You cannot request or approve a change to your own account.",
  NOT_AN_OPERATOR: "That account is not an active platform operator.",
  ALREADY_PENDING: "A change to this operator is already waiting for approval.",
  INVALID_STATE: "That change does not apply to the operator's current state.",
  INVALID_ROLE: "Choose a different platform role from the operator's current one.",
  LAST_SUPER_ADMIN: "This is the last active super admin. Add or reactivate another super admin first.",
};

export interface OperatorState {
  id: string;
  /** users.users.status */
  status: string;
  /** Active platform-authority role keys held. */
  roleKeys: readonly string[];
}

/**
 * Whether `kind` (with `toRole` for a role change) can be requested against this operator, ignoring
 * who is asking. Returns the refusal, or null when it is allowed.
 */
export function validateChange(kind: RequestKind, target: OperatorState, toRole?: string | null): RefusalCode | null {
  const role = primaryRoleKey(target.roleKeys);
  if (kind === "grant") {
    // Making someone an operator: an active user with NO platform role yet, and a platform role to give.
    if (role !== null || target.status !== "active") return "INVALID_STATE";
    return toRole && isPlatformRoleKey(toRole) ? null : "INVALID_ROLE";
  }
  if (role === null) return "NOT_AN_OPERATOR";
  if (kind === "suspend") return target.status === "active" ? null : "INVALID_STATE";
  if (kind === "reactivate") return target.status === "suspended" ? null : "INVALID_STATE";
  // role_change
  if (target.status !== "active") return "INVALID_STATE";
  if (!toRole || !isPlatformRoleKey(toRole) || toRole === role) return "INVALID_ROLE";
  return null;
}

/**
 * True when applying this change to the target would leave no active super_admin.
 * `activeSuperAdmins` is the current number of ACTIVE users holding super_admin.
 */
export function removesLastSuperAdmin(
  kind: RequestKind, target: OperatorState, toRole: string | null | undefined, activeSuperAdmins: number,
): boolean {
  const holdsSuper = target.roleKeys.includes("super_admin") && target.status === "active";
  if (!holdsSuper) return false;
  const losesSuper = kind === "suspend" || (kind === "role_change" && toRole !== "super_admin");
  return losesSuper && activeSuperAdmins <= 1;
}

export function sameId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
