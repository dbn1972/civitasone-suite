/**
 * S8-G4 -- the salary-slip header prints a private grade band (C2, T3 ...) in place of the 7th CPC pay level,
 * and a government slip (no gradeBand) is unchanged.
 */
import { describe, it, expect, afterAll } from "vitest";
import { closePdfRenderer } from "@civitasone/render";
import { pdfText, pdfFlatText } from "@civitasone/render/testing";
import { renderPayslipPdf, type PayslipDocInput } from "../src/modules/payslip-pdf/payslip-document.js";

afterAll(async () => { await closePdfRenderer(); });

function slipInput(employee: Partial<PayslipDocInput["employee"]> = {}, lang: "en" | "hi" = "en"): PayslipDocInput {
  return {
    lang,
    issuer: { orgName: "Digital India Corporation", ministry: "Ministry of Electronics and Information Technology", department: "Digital India Corporation", address: "New Delhi" },
    month: "2026-08",
    employee: {
      employeeNo: "EMP-001", name: "Asha Verma", designation: "Senior Engineer", payLevel: null, payGrade: null,
      department: "Technology", pan: "ABCDE1234F", uan: "100200300400", bankAccount: "123456789012", bankIfsc: "SBIN0001234",
      ...employee,
    },
    slip: {
      components: [{ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 5_000_000 }],
      grossMinor: 5_000_000n, totalDeductionsMinor: 0n, netPayMinor: 5_000_000n,
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n, npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    },
    generatedAt: new Date("2026-11-04T07:00:00.000Z"),
  };
}

describe("payslip header: grade band (S8-G4)", () => {
  it("a banded employee shows 'Grade Band: C2 — Consultant 2' and no Pay Level row", async () => {
    const text = await pdfText(await renderPayslipPdf(slipInput({ gradeBand: { code: "C2", name: "Consultant 2" } })));
    expect(text).toContain("Grade Band");
    expect(text).toContain("C2 — Consultant 2");
    expect(text).not.toContain("Pay Level");
  });

  it("a band whose name equals its code prints the code once", async () => {
    const text = await pdfText(await renderPayslipPdf(slipInput({ gradeBand: { code: "T3", name: "T3" } })));
    expect(text).toContain("T3");
    expect(text).not.toContain("T3 — T3");
  });

  it("the Hindi slip leads with the Hindi label", async () => {
    const flat = await pdfFlatText(await renderPayslipPdf(slipInput({ gradeBand: { code: "M2", name: "Manager 2" } }, "hi")));
    expect(flat).toContain("ग्रेड बैंड");
    expect(flat).toContain("M2");
  });

  it("a government employee (no gradeBand key) still prints 'Pay Level' with Level (grade), exactly as before", async () => {
    const text = await pdfText(await renderPayslipPdf(slipInput({ payLevel: 7, payGrade: "Group B" })));
    expect(text).toContain("Pay Level");
    expect(text).toContain("Level 7 (Group B)");
    expect(text).not.toContain("Grade Band");
  });

  it("gradeBand: null is the same as absent", async () => {
    const text = await pdfText(await renderPayslipPdf(slipInput({ payLevel: 12, gradeBand: null })));
    expect(text).toContain("Level 12");
    expect(text).not.toContain("Grade Band");
  });
});
