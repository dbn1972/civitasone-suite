import { describe, expect, it } from "vitest";
import { PayrollRunDetailListSchema, PayrollRunFullDetailSchema } from "../src/web.js";

// GAP-PAYROLL-RUNS-01 contract test: the payroll-runs payload's money in integer paise
// must be integer digit strings. A payload with non-integer money fails validation.
const run = {
  id: "run-1",
  runDate: "2026-09-01",
  payPeriod: "2026-09",
  employeeCount: 3,
  grossAmount: 150000,
  netAmount: 123456.78,
  deductions: 26543.22,
  status: "paid",
};

describe("PayrollRunDetailSchema — integer-paise money contract", () => {
  it("accepts a legacy payload with no *Minor fields (older payroll-service)", () => {
    expect(PayrollRunDetailListSchema.safeParse([run]).success).toBe(true);
  });

  it("accepts integer paise strings, including values beyond 2^53", () => {
    const parsed = PayrollRunDetailListSchema.safeParse([
      { ...run, grossMinor: "15000000", netMinor: "12345678", deductionsMinor: "2654322" },
      { ...run, id: "run-2", grossMinor: "9007199254740993", netMinor: "9007199254740993", deductionsMinor: "0" },
    ]);
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["a decimal string", "12.5"],
    ["an exponent string", "1e3"],
    ["an empty string", ""],
    ["a rupee-formatted string", "₹100"],
    ["a string with a thousands separator", "1,000"],
  ])("rejects %s as run-level money", (_label, bad) => {
    for (const field of ["grossMinor", "netMinor", "deductionsMinor"]) {
      expect(PayrollRunDetailListSchema.safeParse([{ ...run, [field]: bad }]).success).toBe(false);
    }
  });

  it("rejects a JSON number where an exact-paise string is required", () => {
    expect(PayrollRunDetailListSchema.safeParse([{ ...run, grossMinor: 15000000 }]).success).toBe(false);
  });

  it("rejects non-integer paise on a salary slip embedded in the run detail", () => {
    const slip = { id: "s1", employeeId: "e1", employeeName: "Asha", gross: 1500, deductions: 150, net: 1350, status: "computed" };
    const ok = PayrollRunFullDetailSchema.safeParse({ ...run, salarySlips: [{ ...slip, grossMinor: "150000", deductionsMinor: "15000", netMinor: "135000" }] });
    expect(ok.success).toBe(true);
    for (const field of ["grossMinor", "deductionsMinor", "netMinor"]) {
      const bad = PayrollRunFullDetailSchema.safeParse({ ...run, salarySlips: [{ ...slip, [field]: "1350.5" }] });
      expect(bad.success).toBe(false);
    }
  });

  it("keeps the slip paise strings on the parsed output (they are not stripped)", () => {
    const parsed = PayrollRunFullDetailSchema.parse({
      ...run,
      salarySlips: [{ id: "s1", employeeId: "e1", employeeName: "Asha", gross: 1500, deductions: 150, net: 1350, grossMinor: "150000", deductionsMinor: "15000", netMinor: "135000", status: "computed" }],
    });
    expect(parsed.salarySlips[0]).toMatchObject({ grossMinor: "150000", deductionsMinor: "15000", netMinor: "135000" });
  });
});
