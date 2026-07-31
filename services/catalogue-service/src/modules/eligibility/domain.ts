/**
 * Rule evaluation engine.
 * Matches customer attributes against eligibility rule criteria.
 *
 * Supported rule types:
 * - age_range: { minAge, maxAge }
 * - residency: { allowedRegions: string[] }
 * - segment: { allowedSegments: string[] }
 * - min_income: { minIncomeMinor: number }
 * - custom: arbitrary key-value equality check
 */

export interface EligibilityRule {
  id: string;
  productId: string;
  ruleType: string;
  criteria: Record<string, unknown>;
}

export interface EvaluationResult {
  productId: string;
  eligible: boolean;
  reasons: string[];
}

/**
 * Evaluate a single rule against customer attributes.
 * Returns { pass: boolean, reason: string }
 */
export function evaluateRule(
  rule: EligibilityRule,
  attributes: Record<string, unknown>,
): { pass: boolean; reason: string } {
  switch (rule.ruleType) {
    case "age_range": {
      const age = typeof attributes["age"] === "number" ? attributes["age"] : null;
      if (age === null) return { pass: false, reason: "Missing age attribute" };
      const minAge = (rule.criteria["minAge"] as number) ?? 0;
      const maxAge = (rule.criteria["maxAge"] as number) ?? 999;
      if (age < minAge || age > maxAge) {
        return { pass: false, reason: `Age ${age} not in range [${minAge}, ${maxAge}]` };
      }
      return { pass: true, reason: "Age within range" };
    }
    case "residency": {
      const region = attributes["region"] as string | undefined;
      if (!region) return { pass: false, reason: "Missing region attribute" };
      const allowed = (rule.criteria["allowedRegions"] as string[]) ?? [];
      if (!allowed.includes(region)) {
        return { pass: false, reason: `Region '${region}' not in allowed list` };
      }
      return { pass: true, reason: "Region eligible" };
    }
    case "segment": {
      const segment = attributes["segment"] as string | undefined;
      if (!segment) return { pass: false, reason: "Missing segment attribute" };
      const allowed = (rule.criteria["allowedSegments"] as string[]) ?? [];
      if (!allowed.includes(segment)) {
        return { pass: false, reason: `Segment '${segment}' not in allowed list` };
      }
      return { pass: true, reason: "Segment eligible" };
    }
    case "min_income": {
      const income = typeof attributes["incomeMinor"] === "number" ? attributes["incomeMinor"] : null;
      if (income === null) return { pass: false, reason: "Missing incomeMinor attribute" };
      const minIncome = (rule.criteria["minIncomeMinor"] as number) ?? 0;
      if (income < minIncome) {
        return { pass: false, reason: `Income ${income} below minimum ${minIncome}` };
      }
      return { pass: true, reason: "Income sufficient" };
    }
    case "custom": {
      // Generic key-value equality check
      for (const [key, expectedValue] of Object.entries(rule.criteria)) {
        if (attributes[key] !== expectedValue) {
          return { pass: false, reason: `Attribute '${key}' does not match required value` };
        }
      }
      return { pass: true, reason: "All custom criteria met" };
    }
    default:
      return { pass: false, reason: `Unknown rule type: ${rule.ruleType}` };
  }
}

/**
 * Evaluate all rules for a product. ALL rules must pass for product to be eligible.
 */
export function evaluateProductEligibility(
  rules: EligibilityRule[],
  attributes: Record<string, unknown>,
): EvaluationResult {
  if (rules.length === 0) {
    return { productId: rules[0]?.productId ?? "", eligible: true, reasons: ["No rules defined — eligible by default"] };
  }
  const productId = rules[0]!.productId;
  const reasons: string[] = [];
  let eligible = true;

  for (const rule of rules) {
    const result = evaluateRule(rule, attributes);
    reasons.push(`[${rule.ruleType}] ${result.reason}`);
    if (!result.pass) {
      eligible = false;
    }
  }

  return { productId, eligible, reasons };
}
