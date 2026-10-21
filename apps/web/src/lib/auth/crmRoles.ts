/**
 * Client-safe CRM role constants. roleGuard.ts pulls in next/headers (server
 * only), so a "use client" component cannot import from it; constants that both
 * server pages and client components need live here and roleGuard re-exports
 * them, keeping ONE copy (GAP-CRM-DEDUP-CANDIDATES-01).
 */

/**
 * Roles permitted to read full contact PII (phone/email in the clear) rather
 * than the masked form (GAP-CRM-CONTACTS-02 / GAP-CRM-CONTACTS-DETAIL-02).
 * DPDP: the base crm_user sees masked values; only privileged/admin roles see
 * the clear value. The server remains the authority — this only decides what
 * the UI renders. NOTE (HUMAN REVIEW): true redaction requires the contacts
 * API to omit the clear value for roles outside this set; UI masking alone is
 * cosmetic until that backend change lands.
 */
export const CRM_PII_READ_ROLES = ["crm_admin", "admin", "super_admin", "platform_admin", "tenant_admin"];
