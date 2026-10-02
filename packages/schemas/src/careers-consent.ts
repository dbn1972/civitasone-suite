/**
 * Careers apply-form privacy notice versions, shared by the web form (sends the
 * current one) and hrms-service (accepts only known ones). Bump
 * CAREERS_CONSENT_VERSION whenever the notice wording changes and keep the old
 * value in the accepted list for as long as old pages may still be open.
 */
export const CAREERS_CONSENT_VERSION = "2026-10-v1";
export const CAREERS_CONSENT_ACCEPTED_VERSIONS: readonly string[] = [CAREERS_CONSENT_VERSION];
