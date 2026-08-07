/** Eligibility rule types for Universal Service Designer B3 (mirrors citizen-service domain). */

export const ELIGIBILITY_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "nin", "exists", "missing"] as const;
export type EligibilityOp = (typeof ELIGIBILITY_OPS)[number];

export const ELIGIBILITY_EFFECTS = ["block", "warn", "flag"] as const;
export type EligibilityEffectUi = (typeof ELIGIBILITY_EFFECTS)[number];

export type EligibilityEffectApi = "disqualify" | "refer";

export interface EligibilityAttributeOption {
  id: string;
  label: string;
  group: "profile" | "form";
  valueType?: "text" | "number" | "boolean";
}

export interface EligibilityRuleUi {
  id: string;
  attribute: string;
  op: EligibilityOp;
  value?: string;
  effect: EligibilityEffectUi;
  message: string;
}

export interface EligibilityDesignState {
  ruleSetId?: string;
  name: string;
  rules: EligibilityRuleUi[];
}

export interface EligibilityRuleReason {
  ruleId: string;
  passed: boolean;
  message: string;
}

export interface EligibilityEvalResult {
  outcome: "eligible" | "not_eligible" | "refer_manual";
  reasons: EligibilityRuleReason[];
}

export function effectUiToApi(effect: EligibilityEffectUi): EligibilityEffectApi {
  return effect === "block" ? "disqualify" : "refer";
}

export function effectApiToUi(effect: EligibilityEffectApi): EligibilityEffectUi {
  return effect === "disqualify" ? "block" : "flag";
}

export const PROFILE_ATTRIBUTES: EligibilityAttributeOption[] = [
  { id: "age", label: "Age", group: "profile", valueType: "number" },
  { id: "ward", label: "Ward", group: "profile", valueType: "text" },
  { id: "resident", label: "Resident status", group: "profile", valueType: "boolean" },
  { id: "bpl", label: "Below poverty line", group: "profile", valueType: "boolean" },
  { id: "income_band", label: "Income band", group: "profile", valueType: "text" },
  { id: "mobile_verified", label: "Mobile verified", group: "profile", valueType: "boolean" },
];

export const ELIGIBILITY_OPERATORS: { id: EligibilityOp; label: string; needsValue: boolean }[] = [
  { id: "eq", label: "equals", needsValue: true },
  { id: "neq", label: "does not equal", needsValue: true },
  { id: "gt", label: "is greater than", needsValue: true },
  { id: "gte", label: "is at least", needsValue: true },
  { id: "lt", label: "is less than", needsValue: true },
  { id: "lte", label: "is at most", needsValue: true },
  { id: "exists", label: "is provided", needsValue: false },
  { id: "missing", label: "is missing", needsValue: false },
];

export const ELIGIBILITY_EFFECTS_UI: { id: EligibilityEffectUi; label: string }[] = [
  { id: "block", label: "Block application" },
  { id: "warn", label: "Warn applicant" },
  { id: "flag", label: "Flag for review" },
];
