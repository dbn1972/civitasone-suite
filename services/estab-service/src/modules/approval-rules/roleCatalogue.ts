import { HttpError } from "../../shared/context.js";
import { getIdentityRoleKeys } from "../../shared/identity-client.js";

/**
 * GAP-ESTAB-APPROVAL-MATRIX-03: the approver-role catalogue.
 *
 * Which role codes may appear in an approval rule's chain is an OWNER DECISION
 * (it is not derivable from the repository: the workflow engine takes the roles
 * of a chain from the workflow definition, and tenants name their own roles).
 * So this module does not invent a list. It reads the list the deployment is
 * configured with, from `ESTAB_APPROVER_ROLES` (comma-separated lowercase role
 * codes, e.g. "section_officer,under_secretary,deputy_secretary").
 *
 *  - configured   : creating or editing a rule whose steps name a role outside
 *                   the list is refused with 422 UNKNOWN_APPROVER_ROLE, and the
 *                   web picker offers only these roles.
 *  - not configured: behaviour is unchanged (any non-empty role string is
 *                   accepted); the web falls back to format-checked entry.
 *
 * The list is read on every call so a restart is not needed to change it.
 */

/** Same shape the web matrix accepts (apps/web .../approval-matrix/bands.ts ROLE_TOKEN_RE). */
export const APPROVER_ROLE_CODE_RE = /^[a-z][a-z0-9_]{1,63}$/;

export type ApproverRoleCatalogue = {
  /** True when the deployment declared an authoritative list. */
  configured: boolean;
  /** Where the list came from: the tenant's identity RBAC plus the built-in floor, or the floor alone. */
  source?: "identity+default" | "default" | "env";
  /** The allowed role codes, in the configured order, without duplicates. */
  roles: string[];
};

/** Parse the raw env value; entries that are not valid role codes are dropped. */
export function parseApproverRoleCatalogue(raw: string | undefined): ApproverRoleCatalogue {
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const code = part.trim();
    if (APPROVER_ROLE_CODE_RE.test(code)) seen.add(code);
  }
  const roles = [...seen];
  return { configured: roles.length > 0, roles };
}

/**
 * B2 (owner-approved): the default catalogue when the deployment sets nothing. Without it the
 * list shipped empty and nothing constrained a chain. `ESTAB_APPROVER_ROLES`, when set to at
 * least one valid code, still overrides this list.
 */
export const DEFAULT_APPROVER_ROLES: readonly string[] = [
  "estab_admin",
  "estab_deputy_secretary",
  "estab_division_admin",
];

export function getApproverRoleCatalogue(): ApproverRoleCatalogue {
  const fromEnv = parseApproverRoleCatalogue(process.env.ESTAB_APPROVER_ROLES);
  return fromEnv.configured ? fromEnv : { configured: true, roles: [...DEFAULT_APPROVER_ROLES] };
}

/**
 * B22 (owner-approved): the approver roles of a tenant are its IDENTITY RBAC roles (the list
 * GET /v1/admin/roles serves), unioned with the built-in floor above. The floor stays because the
 * standard file-noting chain (estab_deputy_secretary ...) names roles that identity-service never
 * seeds, so an identity-only list would make the shipped chain unconfigurable. Identity keys that
 * are not valid role codes (e.g. dotted system keys) are dropped. When identity-service cannot
 * answer, the catalogue degrades to the env/default list (never blocks the matrix).
 * An explicit ESTAB_APPROVER_ROLES still wins outright (deployment pin).
 */
export async function loadApproverRoleCatalogue(tenantId: string): Promise<ApproverRoleCatalogue> {
  const fromEnv = parseApproverRoleCatalogue(process.env.ESTAB_APPROVER_ROLES);
  if (fromEnv.configured) return { ...fromEnv, source: "env" };
  const identityKeys = await getIdentityRoleKeys(tenantId);
  const roles = new Set<string>(DEFAULT_APPROVER_ROLES);
  let fromIdentity = false;
  for (const k of identityKeys ?? []) {
    if (APPROVER_ROLE_CODE_RE.test(k)) { roles.add(k); fromIdentity = true; }
  }
  return { configured: true, roles: [...roles], source: fromIdentity ? "identity+default" : "default" };
}

/** Async twin of assertApproverRolesKnown that reads the tenant's identity-backed catalogue. */
export async function assertApproverRolesKnownForTenant(
  tenantId: string,
  steps: ReadonlyArray<{ role: string }> | undefined,
): Promise<void> {
  if (!steps) return;
  const unknown = unknownApproverRoles(steps, await loadApproverRoleCatalogue(tenantId));
  if (unknown.length > 0) {
    throw new HttpError(422, "UNKNOWN_APPROVER_ROLE", `unknown approver role: ${unknown.join(", ")}`);
  }
}

/** The step roles that are not in the catalogue (empty when none is configured). */
export function unknownApproverRoles(
  steps: ReadonlyArray<{ role: string }>,
  catalogue: ApproverRoleCatalogue = getApproverRoleCatalogue(),
): string[] {
  if (!catalogue.configured) return [];
  const allowed = new Set(catalogue.roles);
  const unknown: string[] = [];
  for (const s of steps) {
    if (!allowed.has(s.role) && !unknown.includes(s.role)) unknown.push(s.role);
  }
  return unknown;
}

/** Throws 422 UNKNOWN_APPROVER_ROLE when a configured catalogue does not list every step role. */
export function assertApproverRolesKnown(steps: ReadonlyArray<{ role: string }> | undefined): void {
  if (!steps) return;
  const unknown = unknownApproverRoles(steps);
  if (unknown.length > 0) {
    throw new HttpError(422, "UNKNOWN_APPROVER_ROLE", `unknown approver role: ${unknown.join(", ")}`);
  }
}
