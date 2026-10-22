/**
 * Display masking for contact phone / email (GAP-CRM-CONTACTS-02 /
 * GAP-CRM-CONTACTS-DETAIL-02).
 *
 * Every CRM contact surface shows phone and email MASKED by default - for every
 * role. The clear value is only ever obtained through the audited reveal
 * (ds/MaskedReveal -> POST v1/crm/pii/reveal, reason required, one audit event),
 * and only for roles in CRM_PII_READ_ROLES. These helpers run on the SERVER in
 * the page components, so a clear value is never serialised into client props,
 * the offline seed cache or the DOM.
 *
 * crm-service already redacts phone/email for callers outside its PII-read set
 * ("******3210", "a***@example.com"). Masking such a string again would collapse
 * it to "XXXX", so a value that already carries a mask run passes through.
 */
import { maskEmail, maskPhone } from "@/app/_components/ds/Masked";

/** Three or more consecutive mask glyphs: no real phone or email contains this. */
const ALREADY_MASKED = /[*•]{3,}/;

export function displayMaskedPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALREADY_MASKED.test(value) ? value : maskPhone(value);
}

export function displayMaskedEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  return ALREADY_MASKED.test(value) ? value : maskEmail(value);
}
