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
 * SEC C2 — reserved / system-level RBAC keys.
 *
 * These keys map to the platform's trust source (the same role names the auth
 * layer grants via JWT/x-internal). A DB RBAC key that collides with one of
 * them would let a tenant-scoped admin mint a privileged role/permission and
 * confer platform authority on themselves or others. They may therefore only
 * be created or conferred by a caller with UNCONDITIONAL authority
 * (super_admin / platform_admin) — never by a tenant_admin.
 *
 * NOTE (trust-source mapping): DB RBAC keys are NOT the source of truth for
 * platform authority — `hasUnconditionalAuthority` / `requireRole` read the
 * caller's roles from the auth context (JWT / x-internal), not from these
 * tables. Reserved keys are blocked here so the two trust sources cannot
 * silently diverge (a tenant_admin must not be able to mint `tenant_admin`/
 * `super_admin` rows and have anything downstream treat them as authoritative).
 */
const RESERVED_KEYS = new Set<string>([
  "super_admin",
  "platform_admin",
  "tenant_admin",
  "system",
  "owner",
  "root",
  "service_account",
]);

/** Reserved prefixes that namespace platform-level authority. */
const RESERVED_PREFIXES = ["system.", "platform.", "rbac.admin"];

export function isReservedKey(key: string): boolean {
  const k = key.toLowerCase();
  if (RESERVED_KEYS.has(k)) return true;
  return RESERVED_PREFIXES.some((p) => k === p || k.startsWith(p));
}

/**
 * SEC C2 — allowed permission/role key format. Lowercase, dot/colon-namespaced
 * tokens only (e.g. `hr.employee.read`, `payroll:run`). This is a defense in
 * addition to the zod regex; it rejects keys that are syntactically valid but
 * outside the supported namespace shape.
 */
const KEY_FORMAT = /^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$/;

export function isValidKeyFormat(key: string): boolean {
  return KEY_FORMAT.test(key);
}

/**
 * Assert the caller may create/confer a set of RBAC keys. Reserved/system keys
 * require unconditional authority; everything else must match the allowed
 * format. Throws DomainError on violation.
 */
export function assertKeyAllowed(callerRoles: string[], keys: string[]): void {
  for (const key of keys) {
    if (!isValidKeyFormat(key)) {
      throw new DomainError("INVALID_KEY", `RBAC key '${key}' is not in the allowed namespace format`);
    }
    if (isReservedKey(key) && !hasUnconditionalAuthority(callerRoles)) {
      throw new DomainError(
        "RESERVED_KEY",
        `reserved/system key '${key}' may only be created or conferred by a caller with unconditional authority`,
      );
    }
  }
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
