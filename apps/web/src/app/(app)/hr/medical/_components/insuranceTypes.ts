/** Client-safe types + vocabulary for the medical insurance card / form. */

/** Mirrors hrms-service medical/insurance.ts INSURANCE_SCHEME_TYPES (migration 0254 CHECK). */
export const INSURANCE_SCHEME_TYPES = ["cghs", "state_scheme", "group_mediclaim", "esic", "other"] as const;
export type InsuranceSchemeType = (typeof INSURANCE_SCHEME_TYPES)[number];

/** Mirrors hrms-service medical/insurance.ts DEPENDANT_RELATIONS. */
export const INSURANCE_DEPENDANT_RELATIONS = ["spouse", "child", "parent", "other"] as const;
export type InsuranceDependantRelation = (typeof INSURANCE_DEPENDANT_RELATIONS)[number];

export type InsuranceDependant = { name?: string; relation?: string; dateOfBirth?: string };

/**
 * GET /v1/hrms/medical/insurance, camelCased. cardNumber / schemeId arrive
 * already masked server-side for callers who may not see them in full
 * (cardNumberMasked); the UI never unmasks anything.
 */
export type MedicalInsurance = {
  employeeId: string;
  schemeType: string;
  schemeId: string | null;
  cardNumber: string | null;
  cardNumberMasked: boolean;
  decryptFailed: boolean;
  validityFrom: string | null;
  validityTo: string | null;
  tier: string | null;
  dependants: InsuranceDependant[];
  dependantsCount: number;
  annualLimitMinor: string | null;
};

export function isSchemeType(v: unknown): v is InsuranceSchemeType {
  return typeof v === "string" && (INSURANCE_SCHEME_TYPES as readonly string[]).includes(v);
}

export function isDependantRelation(v: unknown): v is InsuranceDependantRelation {
  return typeof v === "string" && (INSURANCE_DEPENDANT_RELATIONS as readonly string[]).includes(v);
}

/** Map the API's snake_case `data` object; null for anything that isn't one. */
export function mapInsuranceResponse(p: unknown): MedicalInsurance | null {
  const d = (p as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d !== "object" || typeof d.employee_id !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const deps = Array.isArray(d.dependants) ? (d.dependants as InsuranceDependant[]) : [];
  return {
    employeeId: d.employee_id,
    schemeType: String(d.scheme_type ?? ""),
    schemeId: str(d.scheme_id),
    cardNumber: str(d.card_number),
    cardNumberMasked: d.card_number_masked === true,
    decryptFailed: d.decrypt_failed === true,
    validityFrom: str(d.validity_from),
    validityTo: str(d.validity_to),
    tier: str(d.tier),
    dependants: deps,
    dependantsCount: typeof d.dependants_count === "number" ? d.dependants_count : deps.length,
    annualLimitMinor: str(d.annual_limit_minor),
  };
}
