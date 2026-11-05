/**
 * UAT ux-docs: the journal voucher and the sanction order are real PDFs with names, not ids.
 */
import { describe, it, expect } from "vitest";
import { pdfText, pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { EMPTY_DOC_IDENTITY, type DocIdentity } from "@civitasone/render/official";
import { renderSanctionOrderPdf, renderVoucherPdf, voucherNarration, SANCTION_CONDITIONS } from "../src/modules/voucher-print/documents.js";

const AT = new Date("2026-11-04T07:00:00.000Z");
const ISSUER: DocIdentity = {
  ...EMPTY_DOC_IDENTITY, orgNameHi: "भारत सरकार", orgName: "Government of India",
  ministry: "Ministry of Electronics and Information Technology", department: "Digital India Corporation", address: "Electronics Niketan, New Delhi",
};

describe("journal voucher PDF", () => {
  const model = {
    voucherNo: "PAY/2027-02/56afeb09", postingDate: "2027-02-28", type: "payroll_accrual", status: "posted",
    lines: [
      { accountCode: "5001", accountName: "Salaries and wages", debitMinor: 21_375_600n, creditMinor: 0n, narration: "Payroll accrual for Feb 2027" },
      { accountCode: "2101", accountName: "Salaries payable", debitMinor: 0n, creditMinor: 21_375_600n, narration: "Payroll accrual for Feb 2027" },
    ],
    preparedBy: { name: "Meena Iyer", designation: "Accounts Officer" }, preparedAt: "2027-02-28T10:00:00.000Z",
    approvedBy: { name: "Asha Rao", designation: "Under Secretary" }, approvedAt: "2027-02-28T12:00:00.000Z",
    system: true,
  };

  it("prints account names beside codes, the narration and named prepared / approved blocks", async () => {
    const bytes = await renderVoucherPdf(model, ISSUER, AT);
    expect(isPdf(bytes)).toBe(true);
    const flat = await pdfFlatText(bytes);
    expect(flat).toContain("Voucher No. PAY/2027-02/56afeb09");
    expect(flat).toContain("Dated: 28 Feb 2027");
    expect(flat).toContain("5001 Salaries and wages 2,13,756.00");
    expect(flat).toContain("2101 Salaries payable 2,13,756.00");
    expect(flat).toContain("Total 2,13,756.00 2,13,756.00");
    expect(flat).toContain("Rupees Two Lakh Thirteen Thousand Seven Hundred Fifty Six Only");
    expect(flat).toContain("Narration: Payroll accrual for Feb 2027");
    expect(flat).toContain("Prepared by");
    expect(flat).toContain("(Meena Iyer)");
    expect(flat).toContain("Approved by");
    expect(flat).toContain("(Meena Iyer) (Asha Rao)");
    expect(flat).toContain("Accounts Officer Under Secretary");
    expect(flat).toContain("Government of India");
  });

  it("narration is the distinct line narrations", () => {
    expect(voucherNarration([...model.lines, { ...model.lines[0]!, narration: "Arrears" }])).toBe("Payroll accrual for Feb 2027; Arrears");
  });

  it("embeds Noto Sans Devanagari", async () => {
    const fonts = await pdfFonts(await renderVoucherPdf(model, ISSUER, AT));
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });
});

describe("sanction order PDF", () => {
  const order = {
    sanctionNo: "W7-SAN-51E93C05", purpose: "procurement of desktop computers for the e-Office cell", amountMinor: 1_234_500n,
    approvedAt: "2026-11-04T06:30:00.000Z", head: { code: "UT3E1192", hoaCode: "305100101010101", name: "Office Expenses" },
    efileFileNo: "CON/2026/005375", signatory: { name: "Asha Rao", designation: "Under Secretary (Finance)" },
  };

  it("is laid out as a government order: number, date, subject, amount in figures and words, HoA, conditions, signature", async () => {
    const bytes = await renderSanctionOrderPdf(order, ISSUER, AT);
    expect(isPdf(bytes)).toBe(true);
    const text = await pdfText(bytes);
    const flat = await pdfFlatText(bytes);
    expect(text).toContain("No. W7-SAN-51E93C05 Dated: 04 Nov 2026");
    expect(flat).toContain("SANCTION ORDER");
    expect(flat).toContain("Subject: procurement of desktop computers for the e-Office cell");
    expect(flat).toContain("₹ 12,345.00 (Rupees Twelve Thousand Three Hundred Forty Five Only)");
    expect(flat).toContain("305100101010101 (UT3E1192) Office Expenses");
    expect(flat).toContain("financial year 2026-27");
    expect(flat).toContain(SANCTION_CONDITIONS[0]!.slice(0, 60));
    expect(flat).toContain("e-Office file No. CON/2026/005375");
    expect(flat).toContain("(Asha Rao) Under Secretary (Finance)");
    expect(flat).toContain("Copy to:");
    expect(flat).not.toMatch(/Unknown officer/i);
    expect(text).toMatch(/[ऀ-ॿ]/);
  });
});
