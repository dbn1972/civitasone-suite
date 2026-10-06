import { describe, it, expect } from "vitest";
import en from "./en.json";
import hi from "./hi.json";

/**
 * The CRM UI copy added by the LOW-severity gap pass (OverdueTaskAlerts, ConsentField,
 * PostPeriodForm, EditOpportunityClient, deals detail not-found) must exist in both
 * locales with the same keys, ICU placeholders and rich-text tags.
 */
const NAMESPACES = ["consent", "postPeriod", "editOpportunity", "dealDetail", "loading", "dealsNew"] as const;

function flat(o: Record<string, unknown>, pre = ""): Record<string, string> {
  return Object.entries(o).reduce<Record<string, string>>((acc, [k, v]) => {
    if (typeof v === "string") acc[pre + k] = v;
    else Object.assign(acc, flat(v as Record<string, unknown>, `${pre}${k}.`));
    return acc;
  }, {});
}
const tokens = (s: string) => [...s.matchAll(/\{(\w+)\}|<\/?(\w+)>/g)].map((m) => m[0]).sort();

describe.each(NAMESPACES)("crm.%s en/hi parity", (ns) => {
  const enNs = flat((en.crm as unknown as Record<string, Record<string, unknown>>)[ns]);
  const hiNs = flat((hi.crm as unknown as Record<string, Record<string, unknown>>)[ns]);

  it("has the same keys in both locales", () => {
    expect(Object.keys(hiNs).sort()).toEqual(Object.keys(enNs).sort());
  });

  it("keeps ICU placeholders and rich tags identical and every string non-empty", () => {
    for (const k of Object.keys(enNs)) {
      expect(hiNs[k]?.trim().length, `${ns}.${k} (hi) is empty`).toBeGreaterThan(0);
      expect(tokens(hiNs[k] ?? ""), `${ns}.${k}`).toEqual(tokens(enNs[k]!));
    }
  });
});

describe("removed key", () => {
  it("crm.activities.logError is gone from both locales (the error copy is the shared human error)", () => {
    expect((en.crm.activities as Record<string, unknown>).logError).toBeUndefined();
    expect((hi.crm.activities as Record<string, unknown>).logError).toBeUndefined();
  });
});

/** Keys this PR added inside namespaces #1859 owns must also exist in hi, with matching placeholders. */
const MOVED: Record<string, string[]> = {
  crmDedupRulesEditor: ["field.email", "field.gstin", "match.exact", "match.fuzzy"],
  crmQualificationFrameworksEditor: ["added", "namePlaceholder"],
  crmReasonCodesEditor: ["title"],
  crmProductCatalogueEditor: ["currency", "skuPlaceholder", "duplicateCode", "codeUsed", "currencyForProduct"],
  crmOverdueTaskAlerts: ["statLabel", "reassignIntro", "snoozeIntro", "reasonShort", "reassign", "snooze"],
  crmGrievanceDetail: ["assignedId"],
  crmAccountHealthDetail: ["recomputedAt"],
  crmDataQualityView: ["openRecord", "kindContact", "kindAccount"],
  crmLeadScoreRulesEditor: ["removedRules"],
  crmOnboardingList: ["retry"],
  crmServiceRequestNew: ["phoneHint"],
  crmDealDetail: ["steps.qualification"],
};
describe.each(Object.entries(MOVED))("%s additions", (ns, keys) => {
  const e = flat((en as unknown as Record<string, Record<string, unknown>>)[ns]);
  const h = flat((hi as unknown as Record<string, Record<string, unknown>>)[ns]);
  it.each(keys)("%s exists in en and hi with the same placeholders", (k) => {
    expect(e[k], `en ${ns}.${k}`).toBeTruthy();
    expect(h[k], `hi ${ns}.${k}`).toBeTruthy();
    expect(tokens(h[k]!)).toEqual(tokens(e[k]!));
  });
});
