export type RoleView = {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  version: number;
};

export type PermissionView = {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string | null;
  version: number;
};

export type EffectiveAccess = {
  userId: string;
  tenantId: string;
  roles: { id: string; key: string; name: string }[];
  permissions: string[];
};

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Authority / anti-self-escalation core.
 *
 * super_admin and platform_admin have unconditional RBAC authority.
 * Any other admin (e.g. tenant_admin) may only grant authority they themselves
 * hold: to attach a permission to a role, or assign a role to a user, the caller
 * must already possess EVERY permission that the target role would confer
 * (its current permission set, plus the one being added). This prevents a
 * lower-privileged admin from minting a role that grants more than they have
 * and then assigning it (to others or to themselves) — i.e. privilege escalation.
 */
const UNCONDITIONAL_AUTHORITY = ["super_admin", "platform_admin"];

export function hasUnconditionalAuthority(callerRoles: string[]): boolean {
  return callerRoles.some((r) => UNCONDITIONAL_AUTHORITY.includes(r));
}

/**
 * Assert the caller may confer `requiredPermissions` (a set of permission keys).
 * Throws DomainError("SELF_ESCALATION") with 403 semantics if not.
 */
export function assertCanConfer(
  callerRoles: string[],
  callerPermissions: Set<string>,
  requiredPermissions: string[],
): void {
  if (hasUnconditionalAuthority(callerRoles)) return;
  const missing = requiredPermissions.filter((p) => !callerPermissions.has(p));
  if (missing.length > 0) {
    throw new DomainError(
      "SELF_ESCALATION",
      `cannot confer permissions you do not hold: ${missing.join(", ")}`,
    );
  }
}
