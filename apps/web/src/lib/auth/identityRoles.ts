/**
 * Roles permitted to reach the identity-administration surface
 * (/identity and its sub-routes: users, sessions, api-keys, break-glass,
 * webauthn).
 *
 * GAP-IDENTITY-SESSIONS-01 / USERS-01 / WEBAUTHN-01 / API-KEYS-01 /
 * BREAKGLASS-01: the /identity route group previously carried only a
 * <ModuleGate> (tenant module-enablement check, no role check), so any
 * signed-in tenant user whose tenant had the module enabled could reach
 * DPDP-sensitive identity lists (user directory, active sessions with IP /
 * user-agent, break-glass reasons, API keys). The sibling /tenant-admin
 * routes that expose the SAME data have always been behind
 * requireAnyRole(["tenant_admin","platform_admin","super_admin"])
 * (tenant-admin/layout.tsx's ALLOWED), so the data was guarded on one path
 * and open on the other.
 *
 * This mirrors that exact tenant-admin role set so the two identity surfaces
 * agree. DECISION (safest default, flagged for HUMAN REVIEW): the gap notes
 * that too narrow a list could lock out legitimate helpdesk/security staff,
 * but widening it is a business call that must not be made silently — the
 * restrictive admin set is the fail-closed default and matches the backend's
 * own ADMIN role list for /identity/api-keys and /identity/break-glass
 * (services/identity-service apikeys/routes.ts + breakglass/routes.ts:
 * ["platform_admin","super_admin","tenant_admin"]). The server remains the
 * authority; this web gate is defence-in-depth plus honest UX (a
 * non-admin is redirected rather than shown a list whose data calls would
 * 403 anyway).
 */
export const IDENTITY_ADMIN_ROLES = ["tenant_admin", "platform_admin", "super_admin"];
