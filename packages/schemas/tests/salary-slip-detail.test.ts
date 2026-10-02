import { describe, expect, it } from "vitest";
import { SalarySlipDetailSchema } from "../src/web.js";

function slip(status: string) {
  return {
    id: "slip-1", employeeId: "emp-1", employeeNo: "EMP001", employeeName: "Asha Verma",
    department: "Finance", payPeriod: "2026-08", paidDate: null, gross: 100000, deductions: 20000,
    net: 80000, status, basicMinor: 50000, grossMinor: 100000, totalDeductionsMinor: 20000,
    netMinor: 80000, bankAccountLast4: null, components: [],
    pfEmployeeMinor: 0, pfEmployerMinor: 0, gpfMinor: 0, npsEmployeeMinor: 0,
    npsEmployerMinor: 0, esiMinor: 0, tdsMinor: 0,
  };
}

describe("SalarySlipDetailSchema", () => {
  // GET /v1/payroll/slips/:id returns payroll_slips.status raw; the DB CHECK
  // allows exactly these values. Any of them failing validation turns a real
  // slip into the detail pages' retryable-error branch.
  it.each(["computed", "approved", "paid", "held", "exception"])(
    "accepts the real DB slip status %s",
    (status) => {
      expect(SalarySlipDetailSchema.safeParse(slip(status)).success).toBe(true);
    },
  );

  it("still rejects a malformed status (GAP-PAYROLL-SLIPS-DETAIL-04 crash guard)", () => {
    expect(SalarySlipDetailSchema.safeParse(slip("")).success).toBe(false);
    expect(SalarySlipDetailSchema.safeParse(slip("bogus")).success).toBe(false);
  });
});

describe("SalarySlipDetailSchema money fields", () => {
  // Paise are integers; a fractional value means a unit/serialization bug upstream.
  it("rejects a fractional *Minor amount", () => {
    expect(SalarySlipDetailSchema.safeParse({ ...slip("paid"), netMinor: 80000.5 }).success).toBe(false);
    expect(SalarySlipDetailSchema.safeParse({ ...slip("paid"), tdsMinor: 0.1 }).success).toBe(false);
  });
});
