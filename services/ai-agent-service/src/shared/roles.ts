/** Role constants for ai-agent-service. */
export const READ_ROLES = ["ai_user", "ai_admin", "super_admin"];
export const ADMIN_ROLES = ["ai_admin", "super_admin"];
/** Governance reads are also visible to auditors. */
export const GOVERNANCE_ROLES = ["ai_user", "ai_admin", "audit_officer", "super_admin"];

/**
 * Conversations and copilot turns are personal: a plain `ai_user` sees and acts
 * on its own only. ADMIN_ROLES (ai_admin / super_admin) keep tenant-wide access.
 */
export function hasTenantWideAiAccess(roles: readonly string[]): boolean {
  return ADMIN_ROLES.some((r) => roles.includes(r));
}

/** True when the actor may see/act on a record owned by `ownerId`. */
export function canAccessOwned(ctx: { actorId: string; roles: readonly string[] }, ownerId: string): boolean {
  return ownerId === ctx.actorId || hasTenantWideAiAccess(ctx.roles);
}
