/** Client-safe types + vocabulary for the medical insurance card / form. */

/** Mirrors hrms-service medical/insurance.ts INSURANCE_SCHEME_TYPES (migration 0254 CHECK). */
export const INSURANCE_SCHEME_TYPES = ["cghs", "state_scheme", "group_mediclaim", "esic", "other"] as const;
export type InsuranceSchemeType = (typeof INSURANCE_SCHEME_TYPES)[number];

/** Mirrors hrms-service medical/insurance.ts DEPENDANT_RELATIONS. */
export const INSURANCE_DEPENDANT_RELATIONS = ["spouse", "child", "parent", "other"] as const;
export type InsuranceDependantRelation = (typeof INSURANCE_DEPENDANT_RELATIONS)[number];

/** name / dateOfBirth are absent for callers who see relations only; null + decryptFailed when unreadable. */
export type InsuranceDependant = { name?: string | null; relation?: string; dateOfBirth?: string | null; decryptFailed?: boolean };

/**
 * GET /v1/hrms/medical/insurance, camelCased. cardNumber / schemeId arrive
 * masked server-side for everyone but the employee themself
 * (cardNumberMasked); the only way to a clear value is the audited reveal.
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
  const deps: InsuranceDependant[] = Array.isArray(d.dependants)
    ? (d.dependants as Array<Record<string, unknown>>).map((x) => ({
        relation: typeof x.relation === "string" ? x.relation : undefined,
        ...("name" in x ? { name: typeof x.name === "string" ? x.name : null } : {}),
        ...("dateOfBirth" in x ? { dateOfBirth: typeof x.dateOfBirth === "string" ? x.dateOfBirth : null } : {}),
        ...(x.decrypt_failed === true ? { decryptFailed: true } : {}),
      }))
    : [];
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
