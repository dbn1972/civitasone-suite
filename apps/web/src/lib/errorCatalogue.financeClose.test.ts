import { describe, it, expect } from "vitest";
import { DOMAIN_CODE_MESSAGES, resolveHumanError } from "./errorCatalogue";

/**
 * Year-end / budget-control / payroll codes added with the finance-service GFR work (fx-p3):
 * each reads as its own plain reason in English and Hindi, says when nothing was saved or posted,
 * and tells the officer what to do next. Never the generic status copy, never the raw code.
 */
const CASES: Array<{ code: string; status: number; en: RegExp[]; hi: RegExp }> = [
  { code: "NO_BUDGET_PROVISION", status: 422, en: [/no budget provision/i, /nothing was (posted|passed)/i, /budget section/i, /re-appropriation/i, /receipts are not affected/i], hi: /बजट प्रावधान/ },
  { code: "FY_NOT_ACTIVE", status: 422, en: [/financial year that is not active/i, /active year/i, /finance administrator/i], hi: /वित्तीय वर्ष/ },
  { code: "DEP_FUTURE_PERIOD", status: 422, en: [/depreciation/i, /month that has not ended/i], hi: /मूल्यह्रास/ },
  { code: "PERIOD_REOPEN_PENDING", status: 409, en: [/already waiting/i, /second officer/i], hi: /दूसरे अधिकारी/ },
  { code: "FY_OPEN_PERIODS", status: 409, en: [/every month/i, /hard-closed/i], hi: /महीने/ },
  { code: "OPENING_BALANCES_MANUAL", status: 409, en: [/entered by hand/i, /year-end/i, /finance administrator/i], hi: /प्रारंभिक शेष/ },
  { code: "DUPLICATE_RUN_NO", status: 409, en: [/payroll run number is already used/i, /choose another/i], hi: /रन नंबर/ },
  { code: "DEDUCTOR_NOT_CONFIGURED", status: 422, en: [/deductor/i, /TAN/, /PAN/, /not generated/i, /payroll admin/i], hi: /कटौतीकर्ता/ },
];

describe("finance year-end and budget-control codes (fx-p3)", () => {
  it.each(CASES)("$code has its own en copy, not the generic status copy", ({ code, status, en }) => {
    const r = resolveHumanError({ status, code, ctx: { locale: "en", area: "entry" } });
    expect(r.kind).toBe("domain");
    const text = `${r.what} ${r.next}`;
    for (const re of en) expect(text, `${code} ${re}`).toMatch(re);
    expect(text).not.toContain(code);
    expect(text.toLowerCase()).not.toContain("changed by someone else");
    expect(text).not.toMatch(/some details/i);
  });

  it.each(CASES)("$code has Hindi copy that differs from English", ({ code, status, hi }) => {
    const r = resolveHumanError({ status, code, ctx: { locale: "hi" } });
    expect(r.kind).toBe("domain");
    expect(`${r.what} ${r.next}`).toMatch(hi);
    expect(r.what).not.toBe(DOMAIN_CODE_MESSAGES[code]!.en.what);
    expect(r.next).not.toBe(DOMAIN_CODE_MESSAGES[code]!.en.next);
  });

  it("DUPLICATE_RUN_NO wins over the generic duplicate-record copy", () => {
    const r = resolveHumanError({ status: 409, code: "DUPLICATE_RUN_NO", ctx: { locale: "en", area: "payroll run" } });
    expect(r.what).not.toMatch(/with these details already exists/);
  });

  it("refusals that change nothing say so (nothing was posted / saved / generated)", () => {
    for (const code of ["NO_BUDGET_PROVISION", "FY_NOT_ACTIVE", "DEP_FUTURE_PERIOD", "DEDUCTOR_NOT_CONFIGURED"]) {
      const r = resolveHumanError({ status: 422, code, ctx: { locale: "en" } });
      expect(r.what, code).toMatch(/nothing was|not generated|was not/i);
    }
  });
});
