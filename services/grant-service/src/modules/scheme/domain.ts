import type { CriterionRow } from "./schema.js";

export interface BeneficiaryProfile {
  age?: number;
  incomeAnnualMinor?: bigint;
  category?: string;
  geography?: string;
}

export function checkEligibility(criteria: CriterionRow[], profile: BeneficiaryProfile): { eligible: boolean; reason?: string } {
  for (const c of criteria) {
    if (c.criterionKey === "age") {
      const age = profile.age;
      if (age === undefined || age === null) return { eligible: false, reason: "age not provided" };
      if (c.minValue && age < Number(c.minValue)) return { eligible: false, reason: `age ${age} below minimum ${c.minValue}` };
      if (c.maxValue && age > Number(c.maxValue)) return { eligible: false, reason: `age ${age} exceeds maximum ${c.maxValue}` };
    }
    if (c.criterionKey === "income") {
      const income = profile.incomeAnnualMinor ?? 0n;
      if (c.maxValue && income > BigInt(c.maxValue)) return { eligible: false, reason: `income ${income} exceeds limit ${c.maxValue}` };
    }
    if (c.criterionKey === "category") {
      if (c.allowedValues && c.allowedValues.length > 0) {
        if (!profile.category || !c.allowedValues.includes(profile.category)) {
          return { eligible: false, reason: `category '${profile.category}' not in allowed list` };
        }
      }
    }
    if (c.criterionKey === "geography") {
      if (c.allowedValues && c.allowedValues.length > 0) {
        if (!profile.geography || !c.allowedValues.includes(profile.geography)) {
          return { eligible: false, reason: `geography '${profile.geography}' not in allowed list` };
        }
      }
    }
  }
  return { eligible: true };
}
