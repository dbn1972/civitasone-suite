/**
 * S8 G1 (HRMS side): CTC terms on the pay profile. Pure rules: request validation behind
 * S8_CTC_PROFILE_ENABLED (default OFF == exactly the behaviour before this feature), the term shape checks,
 * and the payroll-input feed block. The existing pay-profile-domain tests are unchanged and stay green.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  validateProfileRequest, buildPayProfileFeed, ctcTermsError, ctcProfileEnabled,
  type CtcTerms, type PayProfileRow,
} from "../src/modules/pay-profile/domain.js";

const LINEAGE = "6f1d2c34-5b7a-4c1e-9d0a-2b8e4f7a9c10";
const terms = (o: Partial<CtcTerms> = {}): CtcTerms => ({
  annualFixedMinor: "96000000", // Rs 9,60,000
  annualVariableTargetMinor: null, templateLineageId: LINEAGE, epfWagePolicy: "ceiling", esiOptOut: false, gratuityProvisionOn: true, overrides: [], ...o,
});
const req = (o: Record<string, unknown> = {}) => ({
  payProfile: "ctc_contract" as const, effectiveFrom: "2026-12-01", employeeId: "e1", eligibleForPayroll: true, paymentRoute: "payroll",
  deputation: null, deputationIdGiven: false, consolidatedMonthlyMinor: null, lockedThrough: "2026-10", ...o,
});
const row = (o: Partial<PayProfileRow> = {}): PayProfileRow => ({
  id: "p9", employeeId: "e1", payProfile: "ctc_contract", effectiveFrom: "2026-12-01", effectiveTo: null, status: "active",
  deputationId: null, consolidatedMonthlyMinor: null, requestedBy: "u1", deputationTerms: null, ctcTerms: terms(), ...o,
});
afterEach(() => vi.unstubAllEnvs());

describe("flag S8_CTC_PROFILE_ENABLED (default OFF)", () => {
  it("only the exact string true enables it", () => {
    expect(ctcProfileEnabled({})).toBe(false);
    expect(ctcProfileEnabled({ S8_CTC_PROFILE_ENABLED: "1" })).toBe(false);
    expect(ctcProfileEnabled({ S8_CTC_PROFILE_ENABLED: "true" })).toBe(true);
  });
  it("flag off: a ctc_contract request without terms is accepted exactly as before; terms are refused", () => {
    expect(validateProfileRequest(req())).toBeNull();
    expect(validateProfileRequest(req({ ctcTerms: terms() }))).toBe("CTC_PROFILE_DISABLED");
  });
  it("flag off: the feed carries no ctc block", () => {
    expect(buildPayProfileFeed({ row: row(), changedWithinMonth: false }, null).ctc).toBeUndefined();
  });
});

describe("flag on", () => {
  it("requires terms on a ctc_contract request, and refuses them on every other profile", () => {
    vi.stubEnv("S8_CTC_PROFILE_ENABLED", "true");
    expect(validateProfileRequest(req())).toBe("CTC_TERMS_REQUIRED");
    expect(validateProfileRequest(req({ ctcTerms: terms() }))).toBeNull();
    expect(validateProfileRequest(req({ payProfile: "consolidated_contract", consolidatedMonthlyMinor: 3_000_000n, ctcTerms: terms() }))).toBe("CTC_TERMS_NOT_APPLICABLE");
  });
  it("a month-start effective date, the locked period and the engagement checks still apply first", () => {
    vi.stubEnv("S8_CTC_PROFILE_ENABLED", "true");
    expect(validateProfileRequest(req({ ctcTerms: terms(), effectiveFrom: "2026-12-15" }))).toBe("EFFECTIVE_FROM_NOT_MONTH_START");
    expect(validateProfileRequest(req({ ctcTerms: terms(), effectiveFrom: "2026-10-01" }))).toBe("PERIOD_LOCKED");
  });
  it("the feed carries the approved terms of the resolved ctc_contract row", () => {
    vi.stubEnv("S8_CTC_PROFILE_ENABLED", "true");
    const feed = buildPayProfileFeed({ row: row(), changedWithinMonth: false }, null);
    expect(feed.profile).toBe("ctc_contract");
    expect(feed.ctc).toEqual(terms());
  });
});

describe("ctcTermsError", () => {
  it("accepts well-formed terms including one negotiated HRA override", () => {
    expect(ctcTermsError(terms())).toBeNull();
    expect(ctcTermsError(terms({ overrides: [{ code: "HRA", monthlyMinor: "2400000" }], annualVariableTargetMinor: "12000000" }))).toBeNull();
  });
  it("rejects a zero or absurd CTC, a bad template id, duplicate or malformed overrides", () => {
    expect(ctcTermsError(terms({ annualFixedMinor: "0" }))).toBe("CTC_ANNUAL_INVALID");
    expect(ctcTermsError(terms({ annualFixedMinor: "999999999999999" }))).toBe("CTC_ANNUAL_INVALID");
    expect(ctcTermsError(terms({ templateLineageId: "not-a-uuid" }))).toBe("CTC_TEMPLATE_REQUIRED");
    expect(ctcTermsError(terms({ overrides: [{ code: "HRA", monthlyMinor: "1" }, { code: "HRA", monthlyMinor: "2" }] }))).toBe("CTC_OVERRIDE_DUPLICATE");
    expect(ctcTermsError(terms({ overrides: [{ code: "hra", monthlyMinor: "1" }] }))).toBe("CTC_OVERRIDE_INVALID");
  });
});
