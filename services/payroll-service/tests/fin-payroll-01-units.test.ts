/**
 * fin-payroll-01 pure-logic unit tests (no DB): the F&F pay snapshot maths,
 * the loan-terms bounds, the costing split cap helpers and the employee filter.
 */
import { describe, it, expect } from "vitest";
import { computePaySnapshot, deviatingFields, fyStartYearOf, type SlipMonth } from "../src/modules/fnf/pay-snapshot.js";
import { checkLoanTerms, formatLoanNo } from "../src/modules/loans/policy.js";
import { exceedsCap, isValidSplitPct, toHundredths } from "../src/modules/costing-rules/split-cap.js";
import { filterEmployees } from "../src/modules/employee-lookup/routes.js";
import { minorTotals } from "../src/modules/payroll/queries.js";
import { escapeHtml, renderTemplate, safeFilenamePart } from "../src/shared/html.js";

const m = (month: string, basic: bigint, da: bigint, gross: bigint, tds: bigint): SlipMonth => ({ month, basicMinor: basic, daMinor: da, grossMinor: gross, tdsMinor: tds });

describe("pay snapshot (GAP-PAYROLL-FNF-03)", () => {
  it("FY start year: Apr-Mar", () => {
    expect(fyStartYearOf("2026-03-31")).toBe(2025);
    expect(fyStartYearOf("2026-04-01")).toBe(2026);
  });

  it("last drawn wages = latest month's basic + DA; average over at most the 10 latest months; YTD from 1 April", () => {
    const months: SlipMonth[] = [];
    for (let i = 1; i <= 12; i++) {
      // 2025-04 .. 2026-03; wage 1000.00 + i rupees
      const y = i <= 9 ? 2025 : 2026;
      const mm = i <= 9 ? i + 3 : i - 9;
      months.push(m(`${y}-${String(mm).padStart(2, "0")}`, BigInt(100000 + i * 100), 50000n, 200000n, 1000n));
    }
    const snap = computePaySnapshot(months, "2026-03-31");
    expect(snap.available).toBe(true);
    expect(snap.lastDrawnWagesMinor).toBe(String(100000 + 12 * 100 + 50000));
    // months 3..12 -> basics 100300..101200, mean 100750 (+50000)
    expect(snap.wageMonths).toBe(10);
    expect(snap.avgSalaryLast10MonthsMinor).toBe(String(100750 + 50000));
    expect(snap.ytdMonths).toBe(12);
    expect(snap.salaryYtdMinor).toBe(String(12 * 200000));
    expect(snap.tdsYtdMinor).toBe(String(12 * 1000));
  });

  it("separating mid-FY only counts that FY's months for YTD, and ignores later months", () => {
    const snap = computePaySnapshot([m("2025-03", 1n, 0n, 100n, 1n), m("2025-04", 1n, 0n, 200n, 2n), m("2025-05", 1n, 0n, 300n, 3n), m("2025-06", 1n, 0n, 999n, 9n)], "2025-05-15");
    expect(snap).toMatchObject({ fyStartYear: 2025, ytdMonths: 2, salaryYtdMinor: "500", tdsYtdMinor: "5", wageMonths: 3 });
  });

  it("average rounds half up in integer paise, never floats", () => {
    // wages 1 and 2 -> mean 1.5 -> 2
    expect(computePaySnapshot([m("2026-01", 1n, 0n, 0n, 0n), m("2026-02", 2n, 0n, 0n, 0n)], "2026-02-28").avgSalaryLast10MonthsMinor).toBe("2");
    // a value beyond 2^53 stays exact
    const big = 9_007_199_254_740_993n;
    expect(computePaySnapshot([m("2026-02", big, 0n, big, 0n)], "2026-02-28").lastDrawnWagesMinor).toBe(big.toString());
  });

  it("no slips up to the separation month -> not available", () => {
    expect(computePaySnapshot([m("2026-05", 1n, 0n, 1n, 0n)], "2026-02-28").available).toBe(false);
    expect(computePaySnapshot([], "2026-02-28").available).toBe(false);
  });

  it("deviatingFields: equal values -> none; each differing field named; nothing to compare when unavailable", () => {
    const snap = computePaySnapshot([m("2026-02", 5000n, 1000n, 7000n, 100n)], "2026-02-28");
    const same = { lastDrawnWagesMinor: 6000n, avgSalaryLast10MonthsMinor: 6000n, salaryYtdMinor: 0n, tdsYtdMinor: 0n };
    expect(deviatingFields(snap, { ...same, salaryYtdMinor: 7000n, tdsYtdMinor: 100n })).toEqual([]);
    expect(deviatingFields(snap, { ...same, lastDrawnWagesMinor: 6001n, salaryYtdMinor: 7000n, tdsYtdMinor: 0n })).toEqual(["lastDrawnWages", "tdsYtd"]);
    expect(deviatingFields(computePaySnapshot([], "2026-02-28"), same)).toEqual([]);
  });
});

describe("loan terms (GAP-PAYROLL-LOANS-05)", () => {
  const t = (p: number, e: number, n: number, r = 0) => checkLoanTerms({ principalMinor: BigInt(p), emiMinor: BigInt(e), tenureMonths: n, interestRatePct: r });
  it("accepts a clean interest-free schedule and the exact simple-interest bound", () => {
    expect(t(1_200_000, 100_000, 12)).toEqual({ ok: true });
    expect(t(1_200_000, 110_000, 12, 10)).toEqual({ ok: true }); // 13,20,000 = bound
  });
  it("rejects EMI above principal, below repayment, and above the interest bound", () => {
    expect(t(1_000, 1_001, 1)).toMatchObject({ ok: false, code: "EMI_EXCEEDS_PRINCIPAL" });
    expect(t(1_200_000, 99_999, 12)).toMatchObject({ ok: false, code: "EMI_TOO_LOW_TO_REPAY" });
    expect(t(1_200_000, 110_002, 12, 10)).toMatchObject({ ok: false, code: "EMI_EXCEEDS_INTEREST_BOUND" });
  });
  it("allows one paisa per instalment of rounding above the bound (EMI rounded up)", () => {
    expect(t(1_000_001, 83_334, 12)).toEqual({ ok: true }); // 1,000,008 <= 1,000,001 + 12
  });
  it("loan numbers are LN-<year>-<6 digits>", () => {
    expect(formatLoanNo(2026, 42)).toBe("LN-2026-000042");
    expect(formatLoanNo(2026, 1234567)).toBe("LN-2026-1234567");
  });
});

describe("costing split cap helpers (GAP-PAYROLL-COSTING-02)", () => {
  it("valid split: (0,100], at most 2 decimals", () => {
    for (const ok of [0.01, 33.33, 100]) expect(isValidSplitPct(ok)).toBe(true);
    for (const bad of [0, -1, 100.01, 33.333, NaN, Infinity]) expect(isValidSplitPct(bad)).toBe(false);
  });
  it("hundredths avoid float drift: 33.33 x 3 + 0.01 is exactly 100", () => {
    expect(toHundredths(33.33)).toBe(3333);
    expect(exceedsCap(9999, 0.01)).toBe(false);
    expect(exceedsCap(9999, 0.02)).toBe(true);
    expect(exceedsCap(0, 100)).toBe(false);
  });
});

describe("employee lookup filter", () => {
  const all = new Map([
    ["1", { fullName: "Zoya Khan", departmentName: "Works", employeeNo: "E-9" }],
    ["2", { fullName: "Asha Rao", departmentName: "Finance", employeeNo: null }],
    ["3", { fullName: "Asha Verma", departmentName: "Finance", employeeNo: "E-3" }],
  ]);
  it("matches name or code case-insensitively, sorts by name then id, honours the limit", () => {
    expect(filterEmployees(all, { q: "ASHA", limit: 10 }).map((r) => r.id)).toEqual(["2", "3"]);
    expect(filterEmployees(all, { q: "e-9", limit: 10 }).map((r) => r.id)).toEqual(["1"]);
    expect(filterEmployees(all, { limit: 2 }).map((r) => r.id)).toEqual(["2", "3"]);
    expect(filterEmployees(all, { ids: ["1", "3"], limit: 10 }).map((r) => r.id)).toEqual(["3", "1"]);
  });
});

describe("run totals in paise (GAP-PAYROLL-DISBURSEMENT-08)", () => {
  it("exact strings, deductions floored at 0, beyond 2^53", () => {
    expect(minorTotals(6000050n, 5000025n)).toEqual({ grossMinor: "6000050", netMinor: "5000025", deductionsMinor: "1000025" });
    expect(minorTotals(100n, 150n).deductionsMinor).toBe("0");
    expect(minorTotals(9_007_199_254_740_993n, 1n).grossMinor).toBe("9007199254740993");
  });
});

describe("HTML escaping helpers (stored XSS)", () => {
  const XSS = "<img src=x onerror=alert(1)>";
  it("escapeHtml neutralises tags, quotes and ampersands, exactly once", () => {
    expect(escapeHtml(XSS)).toBe("&lt;img src=x onerror=alert(1)&gt;");
    expect(escapeHtml(`"a" & 'b'`)).toBe("&quot;a&quot; &amp; &#39;b&#39;");
    expect(escapeHtml(null)).toBe("");
  });
  it("renderTemplate escapes every var (employee name, footer) except the raw row keys", () => {
    const out = renderTemplate("<dd>{{employeeName}}</dd><i>{{footerText}}</i><tbody>{{earningsRows}}</tbody>", {
      employeeName: XSS, footerText: XSS, earningsRows: `<tr><td>${escapeHtml(XSS)}</td></tr>`,
    }, ["earningsRows"]);
    expect(out).toContain("<dd>&lt;img src=x onerror=alert(1)&gt;</dd>");
    expect(out).toContain("<i>&lt;img");
    expect(out).toContain("<tbody><tr><td>&lt;img src=x");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("&amp;lt;");
  });
  it("filename parts cannot carry header/markup characters", () => {
    expect(safeFilenamePart('E"<1>\r\n')).toBe("E__1___");
  });
});
