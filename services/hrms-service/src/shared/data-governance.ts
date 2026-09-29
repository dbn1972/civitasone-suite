/**
 * CAP-085 adoption — hrms-service data-governance policy (Aadhaar-only slice).
 *
 * hrms-service stores `hrmsEmployees.aadhaarRef` (schema.ts) encrypted at rest
 * (shared/pii-crypto.ts's `encryptedText`), but until now had no masking rule
 * for it at all — unlike pan/bankAccountNo/bankIfsc/mobile, which the older,
 * bespoke shared/pii-mask.ts already covers. This file adopts the shared
 * @civitasone/data-governance engine for Aadhaar specifically, the same way
 * services/crm-service/src/shared/data-governance.ts and
 * services/citizen-service/src/shared/data-governance.ts already adopted it
 * for their own PII.
 *
 * SCOPE (deliberately narrow): Aadhaar only. UIDAI mandates partial-reveal
 * masking for Aadhaar regardless of any internal product decision, so this
 * rule ships ahead of the still-pending HR PII-visibility decision packet
 * (which fields — bank account, PAN, medical, disciplinary, etc. — get
 * masked from whom). Do NOT add other fields to EMPLOYEE_MASKING_POLICY
 * until that decision lands; see the HR gap-remediation plan (Phase 1,
 * "SF-05 backend half").
 */
import { applyMasking, type MaskingPolicy } from "@civitasone/data-governance";

/**
 * Roles permitted to see Aadhaar unmasked. Matches the HR_ROLES gate already
 * used consistently for HR-privileged actions across this service (e.g.
 * employee/routes.ts, lifecycle/onboarding-routes.ts, service-book/routes.ts)
 * — HR staff who genuinely need the full value for identity verification,
 * not the broader READER_ROLES set (which also includes plain "manager").
 */
export const EMPLOYEE_PII_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export const EMPLOYEE_MASKING_POLICY: MaskingPolicy = {
  // UIDAI convention: reveal only the last 4 digits (e.g. "XXXXXXXX1234").
  aadhaarRef: { strategy: "partial4", allowRoles: EMPLOYEE_PII_ROLES },
};

/** Mask an employee-like record's Aadhaar reference for a caller with the given roles. */
export function maskEmployeeRecord<T extends Record<string, unknown>>(record: T, roles: string[] = []): T {
  return applyMasking(record, EMPLOYEE_MASKING_POLICY, roles);
}
