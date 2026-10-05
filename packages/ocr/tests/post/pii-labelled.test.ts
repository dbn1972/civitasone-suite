import { describe, expect, it } from "vitest";
import { extractFields } from "../../src/post/extract.js";
import { detectPii, maskText, redactPagesForAi } from "../../src/post/pii.js";
import { generateAadhaar, isValidAadhaar } from "../../src/post/verhoeff.js";
import { DEFAULT_PII_POLICY, type FieldKind } from "../../src/types.js";
import { makePage } from "./helpers.js";

const fields = (text: string, kind: FieldKind) => extractFields([makePage([text])]).filter((f) => f.kind === kind);
const pii = (text: string, opts = {}) => detectPii([{ pageNumber: 1, text }], undefined, DEFAULT_PII_POLICY, opts);

describe("labelled identifiers survive extraction while the digits stay masked", () => {
  const CASES: Array<[string, FieldKind, string]> = [
    ["Voucher No: 345678901234", "voucher_no", "345678901234"],
    ["File No 234567890123", "file_no", "234567890123"],
    ["Emp ID 987654321098", "employee_no", "987654321098"],
    ["UTR 412345678901", "reference_no", "412345678901"],
  ];
  it("test strings are checksum-FAILING shapes (the case under test)", () => {
    for (const [, , digits] of CASES) expect(isValidAadhaar(digits)).toBe(false);
  });
  for (const [text, kind, digits] of CASES) {
    it(`${text}: extractFields keeps ${kind} with the true value; detectPii/maskText/AI redaction still mask the digits`, () => {
      const f = fields(text, kind);
      expect(f).toHaveLength(1);
      expect(f[0]?.value).toBe(digits); // the labelled non-PII id keeps its real value (finance matching needs it)
      expect(f[0]?.raw).toBe(digits);
      expect(extractFields([makePage([text])]).some((x) => x.kind === "aadhaar")).toBe(false);
      const findings = pii(text);
      expect(findings.map((x) => [x.type, x.action])).toEqual([["aadhaar", "mask"]]);
      expect(maskText(text, findings)).not.toContain(digits);
      expect(maskText(text, findings)).toContain(digits.slice(-4));
      expect(redactPagesForAi([{ pageNumber: 1, text }])).not.toContain(digits.slice(0, 8));
      expect(pii(text, { strictAadhaar: true })).toHaveLength(0);
    });
  }

  it("a Verhoeff-VALID number under a label is still an Aadhaar (never dropped for the label)", () => {
    const valid = generateAadhaar("23456789012");
    const text = `Voucher No: ${valid}`;
    expect(isValidAadhaar(valid)).toBe(true);
    expect(extractFields([makePage([text])]).some((x) => x.kind === "aadhaar")).toBe(true);
  });
});

describe("obvious non-Aadhaar runs are not flagged (checksum-failing shapes only)", () => {
  it("12-digit timestamp yyyymmddhhmm and a run of years", () => {
    for (const text of ["Timestamp 202610041530", "Table 2024 2025 2026", "Table 2024-2025-2026", "id 199912312359"]) {
      expect(pii(text)).toEqual([]);
      expect(extractFields([makePage([text])]).some((x) => x.kind === "aadhaar")).toBe(false);
      expect(maskText(text, pii(text))).toBe(text);
    }
  });
  it("a 12-digit number that merely starts 20 but is not a date is still flagged", () => {
    expect(pii("n 209912345678").map((x) => x.type)).toEqual(["aadhaar"]); // month 99
    expect(pii("n 203015061530").map((x) => x.type)).toEqual(["aadhaar"]); // month 15
  });
});

describe("finance extraction still works end to end", () => {
  it("Voucher No / Bill No / Amount yield voucher_no, bill no and amount_inr (paise)", () => {
    const f = extractFields([makePage(["Voucher No: 345678901234  Bill No 234567890123  Amount Rs. 1,50,000.00"])]);
    const vouchers = f.filter((x) => x.kind === "voucher_no").map((x) => x.value);
    expect(vouchers).toEqual(expect.arrayContaining(["345678901234", "234567890123"])); // "Bill No" is a voucher_no label
    expect(f.filter((x) => x.kind === "amount_inr").map((x) => x.value)).toEqual(["15000000"]);
    expect(f.some((x) => x.kind === "aadhaar")).toBe(false);
  });
  it("Invoice No is a reference_no", () => {
    expect(fields("Invoice No INV2026-0042 dated 12/03/2026", "reference_no").map((f) => f.value)).toEqual(["INV2026-0042"]);
  });
});

describe("16-digit numbers after an account label are bank accounts, not VIDs", () => {
  const ACC = "1234 5678 9012 3456";
  for (const label of ["A/c No", "A/C No.", "Account No", "Acct No", "Account", "खाता संख्या"]) {
    it(`${label} ${ACC}`, () => {
      const text = `${label} ${ACC}`;
      const findings = pii(text);
      expect(findings.map((f) => f.type)).toEqual(["bank_account"]);
      expect(findings[0]?.action).toBe("mask"); // labelled 16-digit account: flag is upgraded to mask, type stays bank_account
      expect(maskText(text, findings)).toBe(`${label} XXXXXXXXXXXX3456`);
      const ex = fields(text, "account_no")[0];
      expect(ex?.raw).toBe("XXXXXXXXXXXX3456");
      expect(fields(text, "account_no")).toHaveLength(1);
      expect(extractFields([makePage([text])]).some((x) => x.kind === "aadhaar")).toBe(false);
    });
  }
  it("under a masking bank_account policy the labelled account number is masked", () => {
    const text = `A/c No 1234567890123456`;
    const f = detectPii([{ pageNumber: 1, text }], undefined, { ...DEFAULT_PII_POLICY, bank_account: "mask" });
    expect(maskText(text, f)).toBe("A/c No XXXXXXXXXXXX3456");
  });
  it("redact policy is kept; short labelled accounts keep the plain bank_account policy (flag => unmasked)", () => {
    const t16 = "A/c No 1234567890123456";
    const f = detectPii([{ pageNumber: 1, text: t16 }], undefined, { ...DEFAULT_PII_POLICY, bank_account: "redact" });
    expect(maskText(t16, f)).toBe("A/c No [REDACTED]");
    const t12 = "A/c No 123456789012";
    const g = detectPii([{ pageNumber: 1, text: t12 }], undefined);
    expect(g.map((x) => [x.type, x.action])).toEqual([["bank_account", "flag"]]);
    expect(maskText(t12, g)).toBe(t12);
  });
  it("an unlabelled 16-digit number stays a VID/aadhaar and is masked", () => {
    const f = pii("VID 1234 5678 9012 3456");
    expect(f.map((x) => [x.type, x.action])).toEqual([["aadhaar", "mask"]]);
  });
});

describe("Aadhaar-labelled numbers are never extracted as a plain reference (DPDP)", () => {
  const AADHAAR_LABELLED = [
    ["Aadhaar No. 2345-6789-0123 holder", "234567890123"],
    ["UID: 2345-6789-0123", "234567890123"],
    ["आधार संख्या 2345 6789 0123", "234567890123"],
    ["Aadhar No: 234567890123", "234567890123"],
    ["UIDAI 2345-6789-0123", "234567890123"],
    ["Ref No: 2345-6789-0123", "234567890123"],
    ["VID 2345-6789-0123-4567", "2345678901234567"],
  ] as const;
  for (const [text, digits] of AADHAAR_LABELLED) {
    it(`${text}: extracted fields carry no raw digits; detectPii/maskText/AI redaction mask`, () => {
      expect(isValidAadhaar(digits.slice(0, 12))).toBe(false);
      const all = extractFields([makePage([text])]);
      const blob = JSON.stringify(all);
      expect(blob).not.toContain(digits.slice(0, 8));
      expect(blob).not.toContain("2345-6789");
      expect(all.some((f) => f.kind === "aadhaar")).toBe(true);
      expect(all.some((f) => f.kind === "reference_no")).toBe(false);
      const findings = pii(text);
      expect(findings.map((x) => x.type)).toContain("aadhaar");
      expect(maskText(text, findings)).not.toContain(digits.slice(0, 8));
      expect(redactPagesForAi([{ pageNumber: 1, text }])).not.toContain(digits.slice(0, 8));
    });
  }
  it("specific-label ids keep their labelled field (voucher/file/employee/UTR/invoice/bill)", () => {
    for (const [text, kind, digits] of [
      ["Voucher No: 345678901234", "voucher_no", "345678901234"],
      ["Bill No 345678901234", "voucher_no", "345678901234"],
      ["File No 234567890123", "file_no", "234567890123"],
      ["Emp ID 987654321098", "employee_no", "987654321098"],
      ["Employee No 234567890123", "employee_no", "234567890123"],
      ["UTR 412345678901", "reference_no", "412345678901"],
      ["Invoice No 456789012345", "reference_no", "456789012345"],
    ] as const) {
      const f = fields(text, kind);
      expect(f).toHaveLength(1);
      expect(f[0]?.value).toBe(digits);
    }
  });
  it("defence in depth: a generic reference carrying an Aadhaar-shaped number is masked, timestamps are not", () => {
    const f = extractFields([makePage(["Letter No. 2345-6789-0123/A"])]);
    expect(JSON.stringify(f)).not.toContain("2345");
    const g = extractFields([makePage(["Ref No: 2025/0930/1745"])]);
    expect(JSON.stringify(g)).not.toContain("XXXX");
  });
});

describe("round 4: wider Aadhaar keyword window and slash/dot-grouped shapes", () => {
  const MASKED: string[] = [
    "Voucher No 2345-6789-0123 Aadhaar",
    "Voucher No 2345-6789-0123 आधार",
    "Please note Aadhaar number given below, Voucher No: 2345 6789 0123",
    "Aadhaar of employee\nEmp ID 234567890123",
    "Aadhaar of employee\nEmp ID 2345/6789/0123",
  ];
  for (const text of MASKED) {
    it(`keyword near a specific label keeps the Aadhaar shape masked: ${JSON.stringify(text)}`, () => {
      const all = extractFields([makePage(text.split("\n"))]);
      const blob = JSON.stringify(all);
      expect(blob).not.toMatch(/2345.?6789/);
      expect(blob).not.toContain("234567890123");
      expect(all.some((f) => f.kind === "aadhaar")).toBe(true);
      expect(all.some((f) => ["voucher_no", "employee_no", "file_no"].includes(f.kind))).toBe(false);
      expect(maskText(text, pii(text))).not.toMatch(/2345.?6789/);
    });
  }
  it("a keyword beyond the window or in another paragraph does not suppress the labelled value", () => {
    const far = `Aadhaar${" ".repeat(70)}Voucher No: 345678901234`;
    expect(fields(far, "voucher_no")[0]?.value).toBe("345678901234");
    const para = "Aadhaar of employee\n\nEmp ID 987654321098";
    expect(extractFields([makePage(para.split("\n"))]).filter((f) => f.kind === "employee_no")[0]?.value).toBe("987654321098");
    const afterPara = "Voucher No: 345678901234\n\nAadhaar details follow";
    expect(extractFields([makePage(afterPara.split("\n"))]).filter((f) => f.kind === "voucher_no")[0]?.value).toBe("345678901234");
  });
  it("slash and dot 4-4-4 groups are an Aadhaar shape in detectPii/maskText", () => {
    for (const t of ["n 2345/6789/0123", "n 2345.6789.0123"]) {
      expect(pii(t).map((x) => x.type)).toEqual(["aadhaar"]);
      expect(maskText(t, pii(t))).not.toContain("6789");
      const all = extractFields([makePage([t])]);
      expect(all.some((f) => f.kind === "aadhaar")).toBe(true);
      expect(JSON.stringify(all)).not.toContain("6789");
    }
  });
  it("dates, amounts, dotted quads, year runs and timestamps are not flagged", () => {
    for (const t of ["15/03/2024", "15.03.2024", "2024/03/15", "2024-03-15", "Rs. 1,234.56", "ip 192.168.001.001", "2024.2025.2026", "2026/1004/1530", "1234.5678.9012"]) {
      expect(pii(t)).toEqual([]);
    }
  });
  it("trade-off: a dotted 4.4.4 serial starting 2-9 that fails Verhoeff IS flagged", () => {
    expect(pii("ver 2234.5678.9012").map((x) => x.type)).toEqual(["aadhaar"]);
  });
});
