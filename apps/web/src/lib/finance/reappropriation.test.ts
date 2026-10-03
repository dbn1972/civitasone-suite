import { describe, it, expect } from "vitest";
import { reappropriationOptionsFrom, validateReappropriation } from "./reappropriation";

const OPTS = [
  { id: "b1", label: "3054 · Roads · FY 2026-27", availableMinor: "5000000" },
  { id: "b2", label: "4202 · Schools · FY 2026-27", availableMinor: "0" },
];
const ok = { fromBudgetId: "b1", toBudgetId: "b2", amount: "1,000.50", reason: "Savings on roads" };

describe("validateReappropriation", () => {
  it("builds the body with paise as an exact string (no float) and a trimmed reason", () => {
    expect(validateReappropriation({ ...ok, reason: "  Savings on roads " }, OPTS)).toEqual({
      ok: true, body: { fromBudgetId: "b1", toBudgetId: "b2", amountMinor: "100050", reason: "Savings on roads" },
    });
  });
  it("is exact above 2^53 paise", () => {
    const big = [{ id: "b1", label: "x", availableMinor: "99999999999999999999" }, OPTS[1]!];
    const r = validateReappropriation({ ...ok, amount: "90071992547409.93" }, big);
    expect(r).toMatchObject({ ok: true, body: { amountMinor: "9007199254740993" } });
  });
  it("requires both budgets, forbids the same budget twice", () => {
    const r = validateReappropriation({ fromBudgetId: "", toBudgetId: "", amount: "1", reason: "abc" }, OPTS);
    expect(r).toMatchObject({ ok: false, errors: { fromBudgetId: "fromRequired", toBudgetId: "toRequired" } });
    expect(validateReappropriation({ ...ok, toBudgetId: "b1" }, OPTS)).toMatchObject({ ok: false, errors: { toBudgetId: "sameBudget" } });
  });
  it("rejects zero, negative, sub-paise and non-numeric amounts", () => {
    for (const amount of ["0", "-5", "1.005", "abc", ""]) {
      expect(validateReappropriation({ ...ok, amount }, OPTS)).toMatchObject({ ok: false, errors: { amount: "amountInvalid" } });
    }
  });
  it("flags an amount above the source's available balance", () => {
    expect(validateReappropriation({ ...ok, amount: "50000.01" }, OPTS)).toMatchObject({ ok: false, errors: { amount: "amountExceedsAvailable" } });
    expect(validateReappropriation({ ...ok, amount: "50000.00" }, OPTS).ok).toBe(true);
  });
  it("needs a reason of at least 3 characters", () => {
    expect(validateReappropriation({ ...ok, reason: "ab" }, OPTS)).toMatchObject({ ok: false, errors: { reason: "reasonShort" } });
  });
});

describe("reappropriationOptionsFrom", () => {
  it("labels a budget by head and FY and carries its balance", () => {
    expect(reappropriationOptionsFrom([{ id: "b1", majorHead: "3054 Roads", subHead: "NH", financialYear: "2026-27", balance: "123" }])).toEqual([
      { id: "b1", label: "3054 Roads · NH · FY 2026-27", availableMinor: "123" },
    ]);
  });
});
