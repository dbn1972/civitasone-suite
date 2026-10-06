/**
 * Deployment-configurable contact details (GAP-CONTACT-HOME-01/03).
 *
 * Phone number and postal address are business facts, not something to invent, so they
 * are read from NEXT_PUBLIC_ env vars and only rendered when present (the careers page
 * takes the same approach for its grievance contact). The mailboxes are stable product
 * addresses; the acknowledgement SLA is a product commitment recorded here so the copy
 * and the form stay in sync.
 */

export const CONTACT_EMAILS = {
  sales: "sales@civitasone.app",
  general: "info@civitasone.app",
  security: "security@civitasone.app",
} as const;

/** Response-time commitment shown on the page and after a form submit. */
export const CONTACT_SLA_BUSINESS_DAYS = 3;
/** Acknowledgement SLA for security reports (shorter — see security.txt). */
export const SECURITY_ACK_BUSINESS_DAYS = 2;

export function contactPhone(): string | null {
  const v = process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim();
  return v && v.length > 0 ? v : null;
}

export function contactPostalAddress(): string | null {
  const v = process.env.NEXT_PUBLIC_CONTACT_POSTAL_ADDRESS?.trim();
  return v && v.length > 0 ? v : null;
}
