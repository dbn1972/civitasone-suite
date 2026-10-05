import { describe, expect, it } from "vitest";
import { extractFields } from "../../src/post/extract.js";
import { rupeesToPaise } from "../../src/post/patterns.js";
import { generateAadhaar } from "../../src/post/verhoeff.js";
import type { ExtractedField, FieldKind } from "../../src/types.js";
import { makePage } from "./helpers.js";

const NO_MASK = { policy: { aadhaar: "flag", pan: "flag", bank_account: "flag", phone: "flag", email: "flag" } } as const;
const run = (text: string, opts = {}): ExtractedField[] => extractFields([makePage([text])], { ...NO_MASK, ...opts });
const of = (fs: ExtractedField[], k: FieldKind): string[] => fs.filter((f) => f.kind === k).map((f) => f.value);

describe("dates", () => {
  it.each([
    ["Dated 12/03/2024", "2024-03-12"],
    ["Dated 12-03-2024", "2024-03-12"],
    ["Dated 12.03.2024", "2024-03-12"],
    ["on 12 March 2024", "2024-03-12"],
    ["on 12th Mar, 2024", "2024-03-12"],
    ["on 1st September 2023", "2023-09-01"],
    ["March 5, 2024", "2024-03-05"],
    ["१२/०३/२०२४", "2024-03-12"],
    ["दिनांक 15 मार्च 2024", "2024-03-15"],
    ["29/02/2024", "2024-02-29"],
  ])("%s -> %s", (text, iso) => {
    expect(of(run(text), "date")).toEqual([iso]);
  });
  it("rejects impossible dates", () => {
    for (const t of ["31/02/2024", "29/02/2023", "12/13/2024", "00/01/2024", "12/03/1850"]) expect(of(run(t), "date")).toEqual([]);
  });
  it("2-digit year pivot: <=49 -> 20yy, else 19yy; configurable; lower confidence", () => {
    const f = run("12/03/24 and 12/03/65");
    expect(of(f, "date")).toEqual(["2024-03-12", "1965-03-12"]);
    expect(f[0]?.confidence).toBeLessThan(0.9);
    expect(of(run("12/03/60", { twoDigitYearPivot: 70 }), "date")).toEqual(["2060-03-12"]);
  });
  it("does not read dates inside longer digit runs", () => {
    expect(of(run("ref 112/03/20245"), "date")).toEqual([]);
  });
});

describe("amounts (paise string, never float)", () => {
  it.each([
    ["Rs. 1,23,456.78", "12345678"],
    ["Rs 500", "50000"],
    ["INR 45,000", "4500000"],
    ["₹ 2,50,000/-", "25000000"],
    ["Rs. 5/-", "500"],
    ["Rupees 10,00,000.5", "100000050"],
    ["1,000/-", "100000"],
    ["रु. 7,500", "750000"],
    ["Rs. 0.05", "5"],
  ])("%s -> %s paise", (text, paise) => {
    expect(of(run(text), "amount_inr")).toEqual([paise]);
  });
  it("handles very large values exactly (beyond float precision)", () => {
    expect(rupeesToPaise("12,34,56,78,90,12,345.67")).toBe("12345678901234567");
    expect(of(run("Rs. 12,34,56,78,90,12,345.67"), "amount_inr")).toEqual(["12345678901234567"]);
  });
  it("trailing sentence period is not a decimal", () => {
    expect(of(run("Paid Rs. 500."), "amount_inr")).toEqual(["50000"]);
  });
  it("odd grouping lowers confidence", () => {
    const good = run("Rs. 1,23,456")[0]?.confidence ?? 0;
    const odd = run("Rs. 123,456")[0]?.confidence ?? 1;
    expect(odd).toBeLessThan(good);
  });
  it("bare numbers and dates are not amounts", () => {
    expect(of(run("Page 12 of 40 on 12/03/2024"), "amount_inr")).toEqual([]);
  });
});

describe("identifiers", () => {
  it("Aadhaar: Verhoeff-valid extracted with Devanagari digits and O/0 repair; checksum-bad contiguous is low-confidence, strict drops it", () => {
    const a = generateAadhaar("23456789012");
    expect(of(run(`UID ${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`), "aadhaar")).toEqual([a]);
    const deva = [...a].map((c) => String.fromCharCode(0x0966 + Number(c))).join("");
    expect(of(run(deva), "aadhaar")).toEqual([a]);
    const withO = a.replace(/0/g, "O");
    if (withO !== a) expect(of(run(withO), "aadhaar")).toEqual([a]);
    const bad = a.slice(0, 11) + String((Number(a[11]) + 1) % 10);
    const f = run(`No ${bad}`).filter((x) => x.kind === "aadhaar");
    expect(f).toHaveLength(1); // Aadhaar-SHAPED: reported (under-masking is the worse error)
    expect(f[0]?.confidence).toBeLessThanOrEqual(0.4);
    expect(of(extractFields([makePage([`No ${bad}`])], { ...NO_MASK, strictAadhaar: true }), "aadhaar")).toEqual([]);
  });
  it("Aadhaar grouped but checksum-bad is kept with confidence <= 0.4", () => {
    const a = generateAadhaar("23456789012");
    const bad = a.slice(0, 11) + String((Number(a[11]) + 1) % 10);
    const f = run(`${bad.slice(0, 4)} ${bad.slice(4, 8)} ${bad.slice(8)}`).filter((x) => x.kind === "aadhaar");
    expect(f).toHaveLength(1);
    expect(f[0]?.confidence).toBeLessThanOrEqual(0.4);
  });
  it("PAN with entity-type check and digit repair", () => {
    expect(of(run("PAN ABCPE1234F"), "pan")).toEqual(["ABCPE1234F"]);
    expect(of(run("PAN ABCDE1234F"), "pan")).toEqual([]); // 4th char D invalid
    expect(of(run("PAN ABCPEI234F"), "pan")).toEqual(["ABCPE1234F"]); // I -> 1
    expect(of(run("XABCPE1234F"), "pan")).toEqual([]);
  });
  it("IFSC", () => {
    expect(of(run("IFSC SBIN0001234"), "ifsc")).toEqual(["SBIN0001234"]);
    expect(of(run("IFSC SBIN1001234"), "ifsc")).toEqual([]);
  });
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["+91-9876543210", "+919876543210"],
    ["Ph: 91 9876543210", "+919876543210"],
  ])("phone %s", (t, v) => expect(of(run(t), "phone")).toEqual([v]));
  it("rejects phones starting 1-5 and over-long digit runs", () => {
    expect(of(run("5876543210"), "phone")).toEqual([]);
    expect(of(run("98765432101234"), "phone")).toEqual([]);
  });
  it("email lower-cased, trailing dot dropped", () => {
    expect(of(run("Mail Jane.Doe@Example.gov.in."), "email")).toEqual(["jane.doe@example.gov.in"]);
  });
  it("file / reference / voucher / employee numbers", () => {
    const f = run("F.No. 12(3)/2024-Estt. dated 5/1/2024. No. ABC/2024/123 Voucher No: V-2024/045 Emp. No.: 10234");
    expect(of(f, "file_no")).toEqual(["12(3)/2024-Estt"]);
    expect(of(f, "reference_no")).toEqual(["ABC/2024/123"]);
    expect(of(f, "voucher_no")).toEqual(["V-2024/045"]);
    expect(of(f, "employee_no")).toEqual(["10234"]);
    expect(of(run("Ref No: HR/2023/77"), "reference_no")).toEqual(["HR/2023/77"]);
    expect(of(run("Employee ID EMP-20431"), "employee_no")).toEqual(["EMP-20431"]);
    expect(of(run("see emp/998877 here"), "employee_no")).toEqual(["EMP/998877"]);
    expect(of(run("No. 5 only"), "reference_no")).toEqual([]);
  });
  it("custom employee prefix patterns", () => {
    expect(of(run("code GOV-77881 here", { employeePatterns: ["GOV-\\d{5}"] }), "employee_no")).toEqual(["GOV-77881"]);
  });
  it("bank account near labels only (9-18 digits)", () => {
    expect(of(run("A/c No. 1234 5678 9012"), "account_no")).toEqual(["123456789012"]);
    expect(of(run("Account Number: 123456789"), "account_no")).toEqual(["123456789"]);
    expect(of(run("Account No 12345"), "account_no")).toEqual([]);
    expect(of(run("random 123456789012"), "account_no")).toEqual([]);
    // an account number must not also be reported as a phone
    expect(of(run("A/c No. 9876543210"), "phone")).toEqual([]);
  });
});

describe("confidence, bbox, masking", () => {
  it("maps bbox from word boxes and combines OCR confidence with validation", () => {
    const page = makePage(["Dated 12/03/2024 end"], 3, 0.9);
    const f = extractFields([page]).find((x) => x.kind === "date");
    expect(f?.pageNumber).toBe(3);
    expect(f?.bbox).toEqual({ x0: 80, y0: 20, x1: 180, y1: 40 });
    expect(f?.confidence).toBeCloseTo(0.9 * 0.95, 2);
  });
  it("multi-word match gets a union bbox; repeated values map to successive occurrences", () => {
    const a = generateAadhaar("23456789012");
    const spaced = `${a.slice(0, 4)} ${a.slice(4, 8)} ${a.slice(8)}`;
    const f = extractFields([makePage([`${spaced}`, `${spaced}`])], NO_MASK).filter((x) => x.kind === "aadhaar");
    expect(f).toHaveLength(2);
    expect(f[0]?.bbox?.y0).toBe(20);
    expect(f[1]?.bbox?.y0).toBe(50);
    expect(f[0]?.bbox?.x1).toBeGreaterThan(f[0]?.bbox?.x0 ?? 0);
  });
  it("falls back to page mean when no words; bbox null", () => {
    const f = extractFields([{ pageNumber: 1, text: "Dated 12/03/2024", meanConfidence: 0.8 }])[0];
    expect(f?.bbox).toBeNull();
    expect(f?.confidence).toBeCloseTo(0.8 * 0.95, 2);
  });
  it("PII fields are masked in raw AND value under the default policy (Aadhaar mask, PAN flag)", () => {
    const a = generateAadhaar("23456789012");
    const f = extractFields([makePage([`Aadhaar ${a} PAN ABCPE1234F`])]);
    const aad = f.find((x) => x.kind === "aadhaar");
    expect(aad?.raw).toBe(`XXXX XXXX ${a.slice(-4)}`);
    expect(aad?.value).not.toContain(a.slice(0, 8));
    expect(f.find((x) => x.kind === "pan")?.value).toBe("ABCPE1234F");
    expect(JSON.stringify(f)).not.toContain(a);
  });
  it("overlap resolution: a valid Aadhaar is not also a phone / amount", () => {
    const a = generateAadhaar("96543210987");
    const f = run(`UID ${a}`);
    expect(f.filter((x) => x.kind === "aadhaar")).toHaveLength(1);
    expect(f.filter((x) => x.kind === "phone")).toHaveLength(0);
  });
});
