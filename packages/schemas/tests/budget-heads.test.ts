import { describe, it, expect } from "vitest";
import { classifyBudgetHead, isBudgetableHead } from "../src/budget-heads.js";

describe("classifyBudgetHead (GAP-FINANCE-BUDGET-FORMULATION-NEW-02, LMMHA ranges)", () => {
  it("level-0 revenue major head 2202 is budgetable", () => {
    expect(classifyBudgetHead({ classification: "revenue", code: "2202" })).toEqual({ type: "expense", budgetable: true });
  });
  it("capital outlay head 5054 is budgetable", () => {
    expect(isBudgetableHead({ classification: "capital", code: "5054" })).toBe(true);
  });
  it("plan/nonplan and loans heads are budgetable", () => {
    expect(isBudgetableHead({ classification: "plan", code: "2210" })).toBe(true);
    expect(isBudgetableHead({ classification: "nonplan", code: "6216" })).toBe(true);
  });
  it("receipt head 0029 Land Revenue is rejected", () => {
    expect(classifyBudgetHead({ classification: "revenue", code: "0029" })).toEqual({ type: "income", budgetable: false });
    expect(isBudgetableHead({ classification: null, code: "1250" })).toBe(false);
  });
  it("public-account head 8xxx is rejected", () => {
    expect(classifyBudgetHead({ classification: null, code: "8443" })).toEqual({ type: "liability", budgetable: false });
  });
  it("unclassified 2xxx is budgetable", () => {
    expect(isBudgetableHead({ classification: null, code: "2059" })).toBe(true);
    expect(isBudgetableHead({ code: "2059-00-101" })).toBe(true);
  });
  it("explicit asset (or liability/equity/income) is rejected even inside an expenditure range", () => {
    expect(classifyBudgetHead({ classification: "asset", code: "2202" })).toEqual({ type: "asset", budgetable: false });
    expect(isBudgetableHead({ classification: "liability", code: "3054" })).toBe(false);
    expect(isBudgetableHead({ classification: "INCOME", code: "X-1" })).toBe(false);
  });
  it("non-numeric or other codes are budgetable unless explicitly non-expense", () => {
    expect(isBudgetableHead({ classification: null, code: "MISC-01" })).toBe(true);
    expect(isBudgetableHead({ classification: "expense", code: "9001" })).toBe(true);
    expect(isBudgetableHead({ classification: null, code: "22020" })).toBe(true);
  });
});
