/**
 * GAP2-DOMAINS-NEW-07 / owner decision D4c #12 (2026-10-27): registration is re-pointed at the
 * existing admin custom-domains API (POST /api/v1/admin/custom-domains via the proxy), which is
 * role-checked, validated and audited, so the form is live. The flag is kept as a kill switch:
 * set it to false to put the form back to the honest "not available" state (submit disabled, no
 * request issued) without further code change.
 */
export const DOMAIN_REGISTRATION_AVAILABLE = true;
