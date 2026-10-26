/**
 * Role sets for the /tenant web area (GAP-TENANT-HOME-01, HOME-02,
 * CONSENT-EXCHANGE-02). Kept in one place so the layout gate, the hub tile
 * visibility and the page tests all agree on a single list. These mirror the
 * tenant-admin role set used by tenant-admin/layout.tsx. The authoritative
 * control is server-side in tenant-service; these only decide what the web
 * renders / which route the user may reach.
 */
export const TENANT_ADMIN_ROLES = ["tenant_admin", "platform_admin", "super_admin"];

/**
 * OWNER DECISION #19 (TENANT-CONSENT-EXCHANGE-01): only the consent officer (DPO)
 * may approve or reject a consent request on behalf of the data principal.
 * tenant_admin is view-only. tenant-service re-enforces this server-side.
 */
export const CONSENT_DECISION_ROLES = ["consent_officer"];

/**
 * OWNER DECISION #23 (TENANT-DATA-MIGRATION-01): only the migration admin may
 * retry the failed records of an import. tenant-service re-enforces this.
 */
export const MIGRATION_RETRY_ROLES = ["migration_admin"];

/**
 * OWNER DECISION #20 (TENANT-ADMIN-AUDIT): only the audit officer may reveal the
 * unmasked actor email/IP in the audit log. audit-service re-enforces this.
 */
export const AUDIT_REVEAL_ROLES = ["audit_officer"];

/**
 * OWNER DECISION #21 (TENANT-ADMIN-SESSIONS-DETAIL-05): only the security admin may
 * reveal a session's clear IP. identity-service re-enforces this (reveal-ip) and
 * lets this role read the masked session list/detail so it can reach the action.
 */
export const SESSION_IP_REVEAL_ROLES = ["security_admin"];
