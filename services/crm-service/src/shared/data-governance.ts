/**
 * CAP-085 adoption — crm-service data-governance policy.
 *
 * Consolidates the previously-bespoke contact PII masking onto the shared
 * @civitasone/data-governance engine. Field->strategy->role rules live here as
 * a single declarative policy; the exact output format is preserved by plugging
 * crm's existing maskEmail/maskPhone as custom formatters.
 */
import { applyMasking, type MaskingPolicy } from "@civitasone/data-governance";
import { maskEmail, maskPhone } from "./pii-crypto.js";

/** Roles permitted to see contact PII (email/phone) unmasked. */
export const CONTACT_PII_ROLES = ["crm_admin", "super_admin"];

export const CONTACT_MASKING_POLICY: MaskingPolicy = {
  email: { strategy: (v) => maskEmail(v as string | null), allowRoles: CONTACT_PII_ROLES },
  phone: { strategy: (v) => maskPhone(v as string | null), allowRoles: CONTACT_PII_ROLES },
};

/** Mask a contact-like record for a caller with the given roles. */
export function maskContactRecord<T extends Record<string, unknown>>(record: T, roles: string[] = []): T {
  return applyMasking(record, CONTACT_MASKING_POLICY, roles);
}
