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

/**
 * Roles permitted to merge duplicate CRM records: accounts (GAP-CRM-ACCOUNTS-05) and
 * contacts (the Duplicate Candidates screen). A merge is irreversible (the duplicate is
 * tombstoned and its contacts, plans, tenders and child accounts move to the primary), and
 * POST /v1/crm/accounts/merge and POST /v1/crm/contacts/merge answer 403 to everyone but
 * these two roles, so the control is only offered to them -- a plain crm_user used to be
 * walked through a danger confirmation and then refused.
 * Deliberately EXACTLY the server's set (not the wider CRM admin lists): a role this does
 * not name would be offered a button the service rejects. The server remains the authority;
 * this only decides whether the UI offers it. Lives here (client-safe) because the
 * Duplicate Candidates page is a client component; roleGuard re-exports it for server pages.
 */
export const CRM_MERGE_ROLES = ["crm_admin", "super_admin"];
