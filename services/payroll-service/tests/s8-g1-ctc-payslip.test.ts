/**
 * S8 G1: the CTC payslip. CTC components are ordinary earning lines of the existing builder; the employer section
 * gains employer ESI and the gratuity accrual ONLY when a ctc_contract slip supplies them, so every other slip is
 * unchanged (the existing payslip tests stay green).
 */
import { describe, it, expect } from "vitest";
import { payslipSections, type PayslipDocInput } from "../src/modules/payslip-pdf/payslip-document.js";

const slip = (extra: Partial<PayslipDocInput["slip"]> = {}): PayslipDocInput => ({
  lang: "en", issuer: { orgName: "Digital India Corporation" } as PayslipDocInput["issuer"], month: "2026-11",
  employee: { employeeNo: "DIC-C-0917", name: "Ananya Verma", designation: "Project Associate", payLevel: null, payGrade: null, department: "Digital Services", pan: null, uan: null, bankAccount: null, bankIfsc: null },
  slip: {
    components: [
      { code: "BASIC", name: "Basic", type: "earning", amountMinor: 4_000_000 },
      { code: "HRA", name: "House Rent Allowance", type: "earning", amountMinor: 2_000_000 },
      { code: "SPECIAL", name: "Special Allowance", type: "earning", amountMinor: 1_577_600 },
    ],
    grossMinor: 7_577_600n, totalDeductionsMinor: 180_000n, netPayMinor: 7_397_600n,
    pfEmployeeMinor: 180_000n, pfEmployerMinor: 180_000n, gpfMinor: 0n, npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n, ...extra,
  },
});

describe("payslipSections for a CTC slip", () => {
  it("lists the CTC earnings and shows employer PF, employer ESI and the gratuity accrual as employer lines", () => {
    const s = payslipSections(slip({ employerEsiMinor: 64_700n, gratuityProvisionMinor: 192_400n }));
    expect(s.earnings.map((e) => e.label)).toEqual(["Basic", "House Rent Allowance", "Special Allowance"]);
    expect(s.employer).toEqual([
      { label: "EPF + EPS (employer contribution)", amountMinor: 180_000n },
      { label: "ESI (employer contribution)", amountMinor: 64_700n },
      { label: "Gratuity provision (accrued, not paid)", amountMinor: 192_400n },
    ]);
    // the accrual and employer shares never reduce net pay
    expect(s.deductions.reduce((a, d) => a + d.amountMinor, 0n)).toBe(180_000n);
  });
  it("a slip without the CTC figures (every government slip) has exactly the old employer section", () => {
    expect(payslipSections(slip()).employer).toEqual([{ label: "EPF + EPS (employer contribution)", amountMinor: 180_000n }]);
    expect(payslipSections(slip({ employerEsiMinor: 0n, gratuityProvisionMinor: 0n })).employer).toHaveLength(1);
  });
});
