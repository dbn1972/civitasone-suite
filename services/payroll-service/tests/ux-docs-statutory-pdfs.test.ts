/**
 * UAT ux-docs: payslip, Form 16 and Form 12BA are issuable documents. Each is generated from
 * fixture data and parsed back with the repo PDF libraries (pdfjs-dist text, pdf-lib fonts).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { pdfText, pdfFlatText, pdfFonts, isPdf } from "@civitasone/render/testing";
import { amountInWordsEn, resetDocIdentityCache } from "@civitasone/render/official";
import { renderPayslipPdf, payslipSections, type PayslipDocInput } from "../src/modules/payslip-pdf/payslip-document.js";
import { renderForm12baPdf, form12baRows, type Form12baModel } from "../src/modules/form16-pdf/form12ba-pdf-route.js";

vi.mock("../src/modules/letterhead/routes.js", () => ({ loadLetterhead: vi.fn(async () => null) }));
const { renderForm16Html, resolveForm16Deductor } = await import("../src/modules/form16-pdf/form16-document.js");

const AT = new Date("2026-11-04T07:00:00.000Z");

function slipInput(over: Partial<PayslipDocInput> = {}): PayslipDocInput {
  return {
    lang: "en",
    issuer: { orgName: "Office of the Director", ministry: "Ministry of Electronics and Information Technology", department: "Digital India Corporation", address: "New Delhi" },
    month: "2026-08",
    employee: {
      employeeNo: "EMP-001", name: "Asha Verma", designation: "Section Officer", payLevel: 7, payGrade: "Group B",
      department: "Administration", pan: "ABCDE1234F", uan: "100200300400", bankAccount: "123456789012", bankIfsc: "SBIN0001234",
    },
    slip: {
      components: [
        { code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 5_430_000 },
        { code: "DA", name: "Dearness Allowance", type: "earning", amountMinor: 1_225_200 },
        { code: "PT", name: "Professional Tax", type: "deduction", amountMinor: 20_000 },
      ],
      grossMinor: 6_655_200n, totalDeductionsMinor: 559_300n, netPayMinor: 6_095_900n,
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n, npsEmployeeMinor: 539_300n, npsEmployerMinor: 783_000n, esiMinor: 0n, tdsMinor: 0n,
    },
    generatedAt: AT,
    ...over,
  };
}

describe("payslip PDF", () => {
  it("is a real PDF with HRMS identity, masked PAN and net pay in words", async () => {
    const bytes = await renderPayslipPdf(slipInput());
    expect(isPdf(bytes)).toBe(true);
    const text = await pdfText(bytes);
    const flat = await pdfFlatText(bytes);
    expect(text).toContain("Salary Slip for August 2026");
    expect(text).toContain("Asha Verma");
    expect(text).toContain("Section Officer");
    expect(text).toContain("Level 7 (Group B)");
    expect(text).toContain("100200300400");
    expect(text).toContain("XXXXX1234X");
    expect(text).not.toContain("ABCDE1234F");
    expect(text).toContain("XXXXXXXX9012");
    expect(text).not.toContain("123456789012");
    expect(text).toContain("60,959.00");
    expect(flat).toContain(amountInWordsEn(6_095_900n));
    expect(flat).toContain("Rupees Sixty Thousand Nine Hundred Fifty Nine Only");
    expect(text).toMatch(/[ऀ-ॿ]/); // bilingual headings
  });

  it("shows employer NPS as an employer contribution, never under deductions", async () => {
    const sections = payslipSections(slipInput());
    expect(sections.deductions.map((d) => d.label)).toEqual(["Professional Tax", "NPS (employee contribution)"]);
    expect(sections.deductions.reduce((a, d) => a + d.amountMinor, 0n)).toBe(559_300n);
    expect(sections.employer).toEqual([{ label: "NPS (employer contribution)", amountMinor: 783_000n }]);
    const text = await pdfText(await renderPayslipPdf(slipInput()));
    const totalDed = text.indexOf("Total Deductions");
    const employerHeading = text.indexOf("Employer contributions (not deducted from pay)");
    const employerRow = text.indexOf("NPS (employer contribution)");
    expect(totalDed).toBeGreaterThan(0);
    expect(employerHeading).toBeGreaterThan(totalDed);
    expect(employerRow).toBeGreaterThan(employerHeading);
    expect(text).toContain("7,830.00");
  });

  it("the Hindi slip leads with Hindi labels and adds the net pay in Hindi words", async () => {
    const flat = await pdfFlatText(await renderPayslipPdf(slipInput({ lang: "hi" })));
    expect(flat).toContain("Rupees Sixty Thousand Nine Hundred Fifty Nine Only");
    expect(flat).toMatch(/मात्र/);
    expect(flat).toContain("/ Name");
  });

  it("embeds Noto Sans Devanagari and no unembedded font", async () => {
    const fonts = await pdfFonts(await renderPayslipPdf(slipInput({ lang: "hi" })));
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari"))).toBe(true);
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });

  it("an amount the rows do not name is shown as Other deductions (total stays authoritative)", () => {
    const s = payslipSections(slipInput({ slip: { ...slipInput().slip, totalDeductionsMinor: 659_300n } }));
    expect(s.deductions.at(-1)).toEqual({ label: "Other deductions", amountMinor: 100_000n });
  });
});

describe("Form 16", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetDocIdentityCache(); });
  const built = { name: "<EMPLOYER NAME — configure EMPLOYER_NAME>", tan: "<TAN — configure EMPLOYER_TAN>", pan: "<PAN — configure EMPLOYER_PAN>" };

  it("refuses to issue with placeholder employer details", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    await expect(resolveForm16Deductor("aaaaaaaa-0000-4000-8000-000000000001", built)).rejects.toMatchObject({
      code: "FORM16_EMPLOYER_NOT_CONFIGURED", missing: ["employer name", "TAN", "PAN"],
    });
  });

  it("takes name, address, TAN and PAN from the tenant document identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ name: "UAT Org", settings: { documentIdentity: { orgName: "Office of the Director, DIC", address: "Electronics Niketan, New Delhi", tan: "DELD12345E", pan: "AAAGD1234K" } } }) })));
    const d = await resolveForm16Deductor("aaaaaaaa-0000-4000-8000-000000000002", built);
    expect(d).toEqual({ name: "Office of the Director, DIC", tan: "DELD12345E", pan: "AAAGD1234K", address: "Electronics Niketan, New Delhi" });
  });

  it("HTML embeds the Devanagari font and carries bilingual headings, no placeholders", () => {
    const f = {
      employeeId: "e1", fy: "2025-26", assessmentYear: "2026-27",
      form16PartA: { deductor: built, deductee: { name: "Asha Verma", pan: "ABCDE1234F", panFlag: "" }, quarterlyTds: { Q1: 0, Q2: 0, Q3: 0, Q4: 0 }, totalTdsDeposited: 0, note: "Part A." },
      form16PartB: { regime: "new", grossSalary: 798624, standardDeduction: 75000, hraExempt: 0, section80c: 0, section80d: 0, otherDeductions: 0, taxableIncome: 723624, taxOnIncome: 0, rebate87A: 0, surcharge: 0, cess: 0, totalTaxLiability: 0, totalTdsDeducted: 0, balanceTaxPayable: 0, refundDue: 0 },
    } as unknown as Parameters<typeof renderForm16Html>[0];
    const html = renderForm16Html(f, { name: "Office of the Director, DIC", tan: "DELD12345E", pan: "AAAGD1234K", address: "New Delhi" });
    expect(html).toContain("@font-face{font-family:\"Noto Sans Devanagari\"");
    expect(html).toContain("data:font/woff;base64,");
    expect(html).toContain("प्ररूप सं. 16 / FORM No. 16");
    expect(html).toContain("भाग क / Part A");
    expect(html).toContain("DELD12345E");
    expect(html).toContain("₹ 7,98,624.00");
    expect(html).not.toMatch(/configure EMPLOYER/);
  });
});

describe("Form 12BA PDF", () => {
  const model: Form12baModel = {
    fy: "2025-26", assessmentYear: "2026-27",
    employer: { name: "Office of the Director, DIC", tan: "DELD12345E", pan: "AAAGD1234K", address: "New Delhi" },
    employee: { name: "Asha Verma", designation: "Section Officer", pan: "ABCDE1234F" },
    salaryIncomeMinor: 79_862_400n,
    components: [
      { nature: "Accommodation", description: "Government quarter", valueMinor: 1_200_000n, recoveredMinor: 200_000n, taxableMinor: 1_000_000n },
      { nature: "Vehicle", description: "Staff car", valueMinor: 300_000n, recoveredMinor: 0n, taxableMinor: 300_000n },
      { nature: "Misc", description: "Something else", valueMinor: 50_000n, recoveredMinor: 0n, taxableMinor: 50_000n },
    ],
    aggregatePerquisiteMinor: 0n,
    taxDeductedMinor: 0n,
    responsible: { name: "R. K. Sharma", designation: "Drawing and Disbursing Officer" },
    generatedAt: AT,
  };

  it("maps components to the rule rows and totals them", () => {
    const { rows, total } = form12baRows(model);
    expect(rows).toHaveLength(20);
    expect(rows[0]).toMatchObject({ label: "Accommodation", v: 1_200_000n, r: 200_000n, t: 1_000_000n });
    expect(rows[1]).toMatchObject({ label: "Cars / Other automotive", t: 300_000n });
    expect(rows[19]).toMatchObject({ label: "Other benefits or amenities", t: 50_000n });
    expect(total).toEqual({ v: 1_550_000n, r: 200_000n, t: 1_350_000n });
  });

  it("prints the Rule 26A(2)(b) form with employer TAN, masked PAN and the declaration", async () => {
    const bytes = await renderForm12baPdf(model);
    expect(isPdf(bytes)).toBe(true);
    const flat = await pdfFlatText(bytes);
    for (const s of ["FORM NO. 12BA", "[See rule 26A(2)(b)]", "DELD12345E", "Asha Verma, Section Officer, XXXXX1234X", "Total value of perquisites", "13,500.00", "DECLARATION BY EMPLOYER", "(R. K. Sharma)", "Drawing and Disbursing Officer", "₹ 7,98,624.00"]) {
      expect(flat).toContain(s);
    }
    expect(flat).not.toContain("ABCDE1234F");
    expect(flat).not.toMatch(/configure/);
    const fonts = await pdfFonts(bytes);
    expect(fonts.some((f) => f.baseFont.includes("NotoSansDevanagari") && f.embedded)).toBe(true);
  });
});
