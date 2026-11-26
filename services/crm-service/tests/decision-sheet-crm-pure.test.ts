/**
 * Owner decision sheet 2026-11-26 (CRM items C5-C10, C12) -- the pure rules, no database.
 * DB-backed route behaviour is exercised by the existing suites (campaign-roi, pii-masking-reveal).
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isSensitiveFieldName, sensitiveDefinitionError, validateValue, rulesOf, canReadValue, normaliseFieldName,
} from "../src/modules/custom-fields/values-domain.js";
import { checkAgainstMaster } from "../src/shared/master-values.js";
import { INDIAN_STATES_UTS, normaliseGeography } from "../src/shared/india-geography.js";
import { mergeAuthorities, BUILT_IN_RTI_AUTHORITIES } from "../src/modules/rti/authorities.js";
import {
  effectiveDiscountThreshold, DEFAULT_DISCOUNT_THRESHOLD_BPS, effectiveDiscountBps,
} from "../src/modules/deals/quotation-approval-domain.js";
import {
  DEFAULT_SR_RESOLUTION_EMAIL, DEFAULT_SR_TEMPLATE_VARIABLES, templateVariablesOf,
} from "../src/modules/service-requests/default-templates.js";
import { ONBOARDING_MASKING_POLICY, canReadPii, revealRolesFor } from "../src/shared/pii-reveal.js";

describe("C10 custom fields: fail-closed PII definition guard", () => {
  it.each(["Aadhaar", "aadhaar_number", "AadhaarNo", "PAN", "pan number", "panCard", "Passport No", "bank-account", "Voter ID", "IFSC code", "Account Number"])(
    "treats %s as sensitive",
    (name) => expect(isSensitiveFieldName(name)).toBe(true),
  );
  it.each(["Company size", "Panel member", "Pantry", "Industry", "Remarks", "Span", "Expansion plan"])(
    "does not flag the ordinary name %s (word-bounded, no 'pan' substring match)",
    (name) => expect(isSensitiveFieldName(name)).toBe(false),
  );
  it("refuses an Aadhaar-named field unless sensitive is exactly true (false AND omitted both refused)", () => {
    expect(sensitiveDefinitionError("Aadhaar", { sensitive: false })).toMatch(/sensitive:true/);
    expect(sensitiveDefinitionError("Aadhaar", {})).not.toBeNull();
    expect(sensitiveDefinitionError("Aadhaar", null)).not.toBeNull();
    expect(sensitiveDefinitionError("PAN", { sensitive: "yes" })).not.toBeNull();
    expect(sensitiveDefinitionError("Aadhaar", { sensitive: true })).toBeNull();
  });
  it.each(["aadhaarnumber", "aadhaar1", "pancard", "passportno", "pannumber", "drivinglicenceno", "bankaccountno", "voterid"])(
    "refuses the concatenated name %s on create and on update (effective name)",
    (name) => {
      expect(isSensitiveFieldName(name)).toBe(true);
      expect(sensitiveDefinitionError(name, { sensitive: false })).not.toBeNull(); // create
      expect(sensitiveDefinitionError(name, undefined)).not.toBeNull(); // update: stored schema carries no flag
    },
  );
  it.each(["company", "panel", "pantry", "expansion", "span", "companyname"])("still allows %s", (name) =>
    expect(isSensitiveFieldName(name)).toBe(false));
  it("leaves ordinary fields alone", () => {
    expect(sensitiveDefinitionError("Preferred language", null)).toBeNull();
    expect(sensitiveDefinitionError("Preferred language", { sensitive: false })).toBeNull();
  });
  it("splits camelCase and separators before matching", () => {
    expect(normaliseFieldName("aadhaarNumber")).toBe("aadhaar number");
    expect(normaliseFieldName("PAN_no")).toBe("pan no");
  });
});

describe("C10 custom field values", () => {
  const def = (fieldType: string, validationSchema: unknown = null, fieldName = "Field") => ({ id: "f1", fieldName, fieldType, validationSchema });
  it("validates by type", () => {
    expect(validateValue(def("text"), " hello ")).toEqual({ ok: true, value: "hello" });
    expect(validateValue(def("text"), 5).ok).toBe(false);
    expect(validateValue(def("number"), 12.5)).toEqual({ ok: true, value: 12.5 });
    expect(validateValue(def("number"), "12").ok).toBe(false);
    expect(validateValue(def("number"), Number.NaN).ok).toBe(false);
    expect(validateValue(def("boolean"), true).ok).toBe(true);
    expect(validateValue(def("date"), "2026-02-30").ok).toBe(false);
    expect(validateValue(def("date"), "2026-11-26").ok).toBe(true);
  });
  it("enforces select options", () => {
    const d = def("select", { options: ["gold", "silver"] });
    expect(validateValue(d, "gold").ok).toBe(true);
    expect(validateValue(d, "bronze").ok).toBe(false);
    const m = def("multi_select", { options: ["a", "b"] });
    expect(validateValue(m, ["a", "a", "b"])).toEqual({ ok: true, value: ["a", "b"] });
    expect(validateValue(m, ["a", "z"]).ok).toBe(false);
    expect(validateValue(m, []).ok).toBe(false);
  });
  it("hides a sensitive value from roles outside visibleToRoles; default readers are crm_admin / super_admin", () => {
    const named = rulesOf(def("text", { sensitive: true, visibleToRoles: ["compliance_officer"] }, "Aadhaar"));
    expect(canReadValue(named, ["compliance_officer"])).toBe(true);
    expect(canReadValue(named, ["crm_admin"])).toBe(false);
    const dflt = rulesOf(def("text", { sensitive: true }, "Aadhaar"));
    expect(canReadValue(dflt, ["crm_admin"])).toBe(true);
    expect(canReadValue(dflt, ["crm_user"])).toBe(false);
    expect(canReadValue(rulesOf(def("text")), ["crm_user"])).toBe(true);
  });
  it("treats a legacy definition with a sensitive-looking name as sensitive even without the flag", () => {
    expect(rulesOf(def("text", null, "PAN")).sensitive).toBe(true);
    expect(rulesOf(def("text", { sensitive: false }, "PAN")).sensitive).toBe(true);
  });
});

describe("C5 / C6 master-backed values", () => {
  it("is an open vocabulary while the tenant master is empty", () => {
    expect(checkAgainstMaster("anything", [])).toEqual({ ok: true, value: "anything" });
  });
  it("matches case-insensitively and returns the stored master code", () => {
    expect(checkAgainstMaster(" Government ", ["government", "psu"])).toEqual({ ok: true, value: "government" });
  });
  it("rejects a value outside a configured master and lists the allowed codes", () => {
    const r = checkAgainstMaster("goverment", ["government", "psu"]);
    expect(r).toEqual({ ok: false, allowed: ["government", "psu"] });
  });
});

describe("C5 geography master", () => {
  it("accepts a state code or name in any case and returns the code", () => {
    expect(normaliseGeography("od")).toBe("OD");
    expect(normaliseGeography("Odisha")).toBe("OD");
    expect(normaliseGeography("  tamil nadu ")).toBe("TN");
  });
  it("rejects free text such as a compass direction", () => {
    expect(normaliseGeography("north")).toBeNull();
    expect(normaliseGeography("")).toBeNull();
  });
  it("stays in step with the web geography master when the web app is in the checkout", () => {
    const web = resolve(__dirname, "../../../apps/web/src/lib/india/states.ts");
    if (!existsSync(web)) return;
    const src = readFileSync(web, "utf8");
    const pairs = [...src.matchAll(/\{ code: "([A-Z]{2})", name: "([^"]+)" \}/g)].map((m) => ({ code: m[1]!, name: m[2]! }));
    expect(INDIAN_STATES_UTS).toEqual(pairs);
  });
});

describe("C7 RTI public authorities", () => {
  it("returns the 7 built-ins when the register is empty", () => {
    const out = mergeAuthorities([]);
    expect(out).toHaveLength(7);
    expect(out.every((a) => a.source === "built_in")).toBe(true);
  });
  it("adds register departments, de-duplicated case-insensitively and whitespace-folded, after the built-ins", () => {
    const out = mergeAuthorities(["Odisha Revenue Department", "odisha  revenue department ", "ministry of finance", "", "  "]);
    expect(out.map((a) => a.name)).toEqual([...BUILT_IN_RTI_AUTHORITIES, "Odisha Revenue Department"]);
    expect(out.at(-1)).toEqual({ name: "Odisha Revenue Department", source: "register" });
  });
});

describe("C8 quotation discount reference + default threshold", () => {
  it("falls back to the platform default only when the tenant has NO threshold row", () => {
    expect(effectiveDiscountThreshold(null)).toEqual({ maxDiscountBps: DEFAULT_DISCOUNT_THRESHOLD_BPS, enabled: true, source: "default" });
    expect(effectiveDiscountThreshold({ maxDiscountBps: 500, enabled: true })).toEqual({ maxDiscountBps: 500, enabled: true, source: "configured" });
    // an admin who switched the rule off keeps it off
    expect(effectiveDiscountThreshold({ maxDiscountBps: 500, enabled: false }).enabled).toBe(false);
  });
  it("the default is 10%", () => expect(DEFAULT_DISCOUNT_THRESHOLD_BPS).toBe(1000));
  it("scores a line typed below the price-book price and ignores lines with no reference", () => {
    const bps = effectiveDiscountBps([
      { refUnitMinor: "100000", unitPriceMinor: "50000", quantity: 2 }, // price-book 1,000.00 -> quoted 500.00: 50%
      { refUnitMinor: null, unitPriceMinor: "1", quantity: 1 },
    ]);
    expect(bps).toBe(5000);
    expect(bps).toBeGreaterThan(DEFAULT_DISCOUNT_THRESHOLD_BPS);
  });
});

describe("C9 platform-default service-request email", () => {
  it("is an email template named service_request_resolution", () => {
    expect(DEFAULT_SR_RESOLUTION_EMAIL.channel).toBe("email");
    expect(DEFAULT_SR_RESOLUTION_EMAIL.name).toBe("service_request_resolution");
  });
  it("uses only variables the notify consumer actually supplies", () => {
    const used = [...templateVariablesOf(DEFAULT_SR_RESOLUTION_EMAIL.subject), ...templateVariablesOf(DEFAULT_SR_RESOLUTION_EMAIL.body)];
    for (const v of used) expect(DEFAULT_SR_TEMPLATE_VARIABLES).toContain(v);
    expect(new Set(used)).toEqual(new Set(DEFAULT_SR_TEMPLATE_VARIABLES));
  });
});

describe("C12 onboarding kycReference", () => {
  it("is masked for every role, KYC approvers included", () => {
    expect(ONBOARDING_MASKING_POLICY.kycReference?.allowRoles).toEqual([]);
    expect(canReadPii("onboarding", ["crm_admin"])).toBe(false);
    expect(canReadPii("onboarding", ["super_admin", "tenant_admin"])).toBe(false);
  });
  it("the audited reveal stays restricted to the KYC approvers", () => {
    expect(revealRolesFor("onboarding")).toEqual(["crm_admin", "super_admin", "tenant_admin"]);
  });
});
