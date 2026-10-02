/**
 * PAY-PROFILES (PR1): pure rules for per-employee pay profiles -- month
 * resolution, the payroll-input feed block, advisories, request validation,
 * deputation-term completeness, maker-checker approval planning, and the
 * engagement category resolver.
 */
import { describe, it, expect } from "vitest";
import {
  resolveProfileForMonth, buildPayProfileFeed, payProfileAdvisories, validateProfileRequest,
  deputationTermsError, planApproval, monthBounds, dayBefore, ADVISORIES,
  type PayProfileRow, type DeputationTerms,
} from "../src/modules/pay-profile/domain.js";
import { buildTypeCategoryResolver, buildTypeResolver, DEFAULT_POLICY } from "../src/modules/employee/engagement-policy.js";

const row = (o: Partial<PayProfileRow>): PayProfileRow => ({
  id: "p1", employeeId: "e1", payProfile: "consolidated_contract", effectiveFrom: "2026-11-01",
  effectiveTo: null, status: "active", deputationId: null, consolidatedMonthlyMinor: 3_000_000n, requestedBy: "u1", ...o,
});

const dep = (o: Partial<DeputationTerms> = {}): DeputationTerms => ({
  id: "d1", employeeId: "e1", status: "active", direction: "in", payOption: "parent_scale", stationType: "other",
  parentCadre: "CSS", parentOrganisation: "Ministry X", parentPayLevel: 7, parentBasicMinor: 4_490_000n,
  postPayLevel: null, postBasicMinor: null, allowanceMode: "auto", deputationAllowanceMinor: 0n,
  foreignService: false, parentPensionScheme: "NPS", daSource: "central", parentDaRateBps: null,
  tenureFrom: "2026-10-15", tenureTo: "2029-10-14", ...o,
});

describe("monthBounds / dayBefore", () => {
  it("handles month lengths and leap years", () => {
    expect(monthBounds("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthBounds("2026-11")).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  });
});

describe("resolveProfileForMonth", () => {
  it("no rows -> no profile (govt_scale default downstream)", () => {
    expect(resolveProfileForMonth([], "2026-11", "2020-01-01")).toEqual({ row: null, changedWithinMonth: false });
  });
  it("ignores pending and rejected rows -- only an APPROVED profile changes pay", () => {
    const r = resolveProfileForMonth([row({ status: "pending" }), row({ id: "p2", status: "rejected" })], "2026-11", null);
    expect(r.row).toBeNull();
  });
  it("picks the active row covering the 1st; a row starting next month does not apply yet", () => {
    const rows = [row({ id: "old", effectiveFrom: "2026-01-01", effectiveTo: "2026-11-30" }), row({ id: "new", effectiveFrom: "2026-12-01" })];
    expect(resolveProfileForMonth(rows, "2026-11", null).row?.id).toBe("old");
    expect(resolveProfileForMonth(rows, "2026-12", null).row?.id).toBe("new");
    expect(resolveProfileForMonth(rows, "2025-12", null).row).toBeNull();
  });
  it("anchors on the joining date for a mid-month joiner", () => {
    const rows = [row({ effectiveFrom: "2026-11-01" })];
    expect(resolveProfileForMonth(rows, "2026-11", "2026-11-15").row?.id).toBe("p1");
  });
  it("flags a change inside the month (defensive; v1 profiles start on the 1st)", () => {
    const rows = [row({ id: "a", effectiveFrom: "2026-01-01", effectiveTo: "2026-11-14" })];
    expect(resolveProfileForMonth(rows, "2026-11", null).changedWithinMonth).toBe(true);
  });
});

describe("buildPayProfileFeed", () => {
  it("defaults to govt_scale with source=default", () => {
    expect(buildPayProfileFeed({ row: null, changedWithinMonth: false }, null)).toEqual({
      profile: "govt_scale", source: "default", profileId: null, effectiveFrom: null, changedWithinMonth: false,
    });
  });
  it("consolidated: carries the amount as a digit string", () => {
    const f = buildPayProfileFeed({ row: row({}), changedWithinMonth: false }, null);
    expect(f).toMatchObject({ profile: "consolidated_contract", source: "assigned", profileId: "p1", consolidatedMonthlyMinor: "3000000" });
    expect(f.deputation).toBeUndefined();
  });
  it("deputation profile: carries the deputation pay terms (money as strings)", () => {
    const f = buildPayProfileFeed(
      { row: row({ payProfile: "deputation_parent_scale", deputationId: "d1", consolidatedMonthlyMinor: null }), changedWithinMonth: false },
      dep({ allowanceMode: "fixed", deputationAllowanceMinor: 300_000n }),
    );
    expect(f.profile).toBe("deputation_parent_scale");
    expect(f.deputation).toMatchObject({
      id: "d1", direction: "in", option: "parent_scale", stationType: "other", parentBasicMinor: "4490000",
      allowanceMode: "fixed", fixedAllowanceMinor: "300000", parentPensionScheme: "NPS", daSource: "central",
    });
  });
});

describe("payProfileAdvisories", () => {
  const base = { payMode: "monthly", employeeType: "permanent", activeDeputation: null, month: "2026-11" };
  const govt = buildPayProfileFeed({ row: null, changedWithinMonth: false }, null);
  it("no advisories for an ordinary govt-scale employee", () => {
    expect(payProfileAdvisories({ ...base, feed: govt })).toEqual([]);
  });
  it("consolidated engagement still on govt_scale", () => {
    expect(payProfileAdvisories({ ...base, feed: govt, payMode: "consolidated" })).toEqual([ADVISORIES.consolidatedOnGovtScale]);
  });
  it("deputationist (legacy type or active deputed-IN) without a deputation profile", () => {
    expect(payProfileAdvisories({ ...base, feed: govt, employeeType: "deputation" })).toEqual([ADVISORIES.deputationistWithoutProfile]);
    expect(payProfileAdvisories({ ...base, feed: govt, activeDeputation: dep() })).toEqual([ADVISORIES.deputationistWithoutProfile]);
    expect(payProfileAdvisories({ ...base, feed: govt, activeDeputation: dep({ direction: "out" }) })).toEqual([]);
  });
  it("deputation profile whose deputation does not cover the month, and foreign service", () => {
    const f = buildPayProfileFeed(
      { row: row({ payProfile: "deputation_parent_scale", deputationId: "d1" }), changedWithinMonth: false },
      dep({ tenureTo: "2026-10-31", foreignService: true }),
    );
    expect(payProfileAdvisories({ ...base, feed: f, employeeType: "deputation" }))
      .toEqual([ADVISORIES.deputationNotActiveForMonth, ADVISORIES.foreignService]);
  });
});

describe("validateProfileRequest", () => {
  const ok = {
    payProfile: "consolidated_contract" as const, effectiveFrom: "2026-11-01", employeeId: "e1",
    eligibleForPayroll: true, paymentRoute: "payroll", deputation: null, deputationIdGiven: false,
    consolidatedMonthlyMinor: 3_000_000n, lockedThrough: null,
  };
  it("accepts a complete request", () => { expect(validateProfileRequest(ok)).toBeNull(); });
  it("requires the 1st of a month", () => {
    expect(validateProfileRequest({ ...ok, effectiveFrom: "2026-11-15" })).toBe("EFFECTIVE_FROM_NOT_MONTH_START");
  });
  it("refuses a start on or before the last locked payroll month", () => {
    expect(validateProfileRequest({ ...ok, lockedThrough: "2026-11" })).toBe("PERIOD_LOCKED");
    expect(validateProfileRequest({ ...ok, lockedThrough: "2026-10" })).toBeNull();
  });
  it("refuses a non-payroll engagement (consultant / agency / stipend)", () => {
    expect(validateProfileRequest({ ...ok, eligibleForPayroll: false })).toBe("PROFILE_ENGAGEMENT_MISMATCH");
    expect(validateProfileRequest({ ...ok, paymentRoute: "invoice" })).toBe("PROFILE_ENGAGEMENT_MISMATCH");
  });
  it("consolidated needs a positive amount; others must not carry one", () => {
    expect(validateProfileRequest({ ...ok, consolidatedMonthlyMinor: null })).toBe("CONSOLIDATED_AMOUNT_REQUIRED");
    expect(validateProfileRequest({ ...ok, consolidatedMonthlyMinor: 0n })).toBe("CONSOLIDATED_AMOUNT_REQUIRED");
    expect(validateProfileRequest({ ...ok, payProfile: "govt_scale" })).toBe("CONSOLIDATED_AMOUNT_NOT_APPLICABLE");
  });
  it("deputation profiles need a matching, active, complete deputation of the same employee", () => {
    const d = { ...ok, payProfile: "deputation_parent_scale" as const, consolidatedMonthlyMinor: null, deputationIdGiven: true };
    expect(validateProfileRequest({ ...d, deputation: null })).toBe("DEPUTATION_NOT_FOUND");
    expect(validateProfileRequest({ ...d, deputation: dep({ employeeId: "other" }) })).toBe("DEPUTATION_NOT_FOUND");
    expect(validateProfileRequest({ ...d, deputation: dep({ status: "repatriated" }) })).toBe("DEPUTATION_NOT_ACTIVE");
    expect(validateProfileRequest({ ...d, deputation: dep({ payOption: "post_scale" }) })).toBe("DEPUTATION_OPTION_MISMATCH");
    expect(validateProfileRequest({ ...d, deputation: dep({ stationType: null }) })).toBe("STATION_TYPE_REQUIRED");
    expect(validateProfileRequest({ ...d, deputation: dep() })).toBeNull();
    expect(validateProfileRequest({ ...d, payProfile: "deputation_post_scale", deputation: dep({ payOption: "post_scale" }) }))
      .toBe("POST_BASIC_REQUIRED");
  });
  it("a non-deputation profile must not reference a deputation", () => {
    expect(validateProfileRequest({ ...ok, payProfile: "ctc_contract", consolidatedMonthlyMinor: null, deputationIdGiven: true }))
      .toBe("DEPUTATION_ID_NOT_APPLICABLE");
  });
});

describe("deputationTermsError", () => {
  const t = { payOption: "parent_scale", stationType: "same", direction: "out", parentBasicMinor: null, postBasicMinor: null, daSource: "central", parentDaRateBps: null };
  it("Option A deputed-OUT may rely on the employee's own basic", () => { expect(deputationTermsError(t)).toBeNull(); });
  it("Option A deputed-IN needs the parent basic", () => {
    expect(deputationTermsError({ ...t, direction: "in" })).toBe("PARENT_BASIC_REQUIRED");
  });
  it("parent-State DA needs a rate", () => {
    expect(deputationTermsError({ ...t, daSource: "parent" })).toBe("PARENT_DA_RATE_REQUIRED");
    expect(deputationTermsError({ ...t, daSource: "parent", parentDaRateBps: 4600 })).toBeNull();
  });
  it("no option = no requirements (terms not used for pay yet)", () => {
    expect(deputationTermsError({ ...t, payOption: null, stationType: null })).toBeNull();
  });
});

describe("planApproval (maker-checker ordering)", () => {
  it("first profile: nothing to close", () => {
    expect(planApproval({ id: "n", effectiveFrom: "2026-11-01" }, [])).toEqual({ closeRowId: null, closeOn: null });
  });
  it("closes the open active row the day before", () => {
    expect(planApproval({ id: "n", effectiveFrom: "2027-03-01" }, [{ id: "o", effectiveFrom: "2026-11-01", effectiveTo: null }]))
      .toEqual({ closeRowId: "o", closeOn: "2027-02-28" });
  });
  it("refuses a start on/before an active row's start or inside a closed range", () => {
    expect(planApproval({ id: "n", effectiveFrom: "2026-11-01" }, [{ id: "o", effectiveFrom: "2026-11-01", effectiveTo: null }]))
      .toEqual({ error: "PROFILE_EFFECTIVE_NOT_AFTER_CURRENT" });
    expect(planApproval({ id: "n", effectiveFrom: "2026-12-01" }, [{ id: "o", effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31" }]))
      .toEqual({ error: "PROFILE_EFFECTIVE_NOT_AFTER_CURRENT" });
  });
});

describe("buildTypeCategoryResolver", () => {
  const canonical = [
    { category: "contractual", eligibleForPayroll: true, paymentRoute: "payroll", payMode: "consolidated" },
    { category: "consultant", eligibleForPayroll: false, paymentRoute: "invoice", payMode: "none" },
  ];
  const tenant = [
    { code: "CONTRACT_STAFF", category: "contractual", eligibleForPayroll: false },
    { code: "VISITING", category: "other", eligibleForPayroll: true, paymentRoute: "payroll", payMode: "monthly" },
  ];
  const r = buildTypeCategoryResolver(tenant, canonical);
  it("categorised tenant type -> canonical category and policy", () => {
    expect(r("CONTRACT_STAFF").category).toBe("contractual");
    expect(r("CONTRACT_STAFF").policy.payMode).toBe("consolidated");
  });
  it("un-categorised tenant type -> 'other'; canonical code -> itself; unknown -> 'legacy'", () => {
    expect(r("VISITING").category).toBe("other");
    expect(r("consultant").category).toBe("consultant");
    expect(r("permanent")).toEqual({ category: "legacy", policy: DEFAULT_POLICY });
  });
  it("buildTypeResolver still returns exactly the same policy", () => {
    const p = buildTypeResolver(tenant, canonical);
    for (const code of ["CONTRACT_STAFF", "VISITING", "consultant", "permanent"]) expect(p(code)).toEqual(r(code).policy);
  });
});
