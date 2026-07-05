/**
 * Unit tests for APBS (Aadhaar Payment Bridge System) file writer.
 * Validates fixed-width formatting, Aadhaar/IIN fields, transaction codes,
 * record lengths, and CRLF line endings.
 */
import { describe, it, expect } from "vitest";
import { generateApbsFile, type ApbsFileInput, type ApbsBeneficiary } from "../src/modules/bank-transfer/apbs-writer.js";
import type { SponsorBankConfigRow } from "../src/modules/sponsor-config/schema.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSponsorConfig(overrides?: Partial<SponsorBankConfigRow>): SponsorBankConfigRow {
  return {
    tenantId: "00000000-0000-0000-0000-000000000001",
    sponsorCode: "HDFC",
    sponsorIfsc: "HDFC0000001",
    sponsorAccount: "9876543210",
    utilityCode: "NACH00000000012345",
    userNumber: "USR123",
    settlementOffsetDays: 1,
    nachEnabled: true,
    apbsEnabled: true,
    maxRecordsPerFile: 100000,
    maxAmountPerFileMinor: 1000000000n,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "00000000-0000-0000-0000-000000000002",
    updatedBy: "00000000-0000-0000-0000-000000000002",
    ...overrides,
  };
}

function makeBeneficiary(overrides?: Partial<ApbsBeneficiary>): ApbsBeneficiary {
  return {
    aadhaarNumber: "123456789012",
    iin: "600001",
    amountMinor: 5000000n, // ₹50,000
    name: "Rajesh Kumar",
    reference: "EMP001",
    narration: "Pension Jun 2026",
    ...overrides,
  };
}

function makeInput(overrides?: Partial<ApbsFileInput>): ApbsFileInput {
  return {
    sponsorConfig: makeSponsorConfig(),
    settlementDate: "05072026",
    beneficiaries: [makeBeneficiary()],
    batchNumber: 1,
    ...overrides,
  };
}

/**
 * Split content into records (lines without the CRLF).
 */
function getLines(content: string): string[] {
  return content.split("\r\n").filter((line) => line.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Record Length Validation — Every line must be EXACTLY 160 chars
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — record length (160 chars)", () => {
  it("header record (type 01) is exactly 160 chars", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    expect(lines[0]!.length).toBe(160);
    expect(lines[0]!.startsWith("01")).toBe(true);
  });

  it("detail record (type 02) is exactly 160 chars", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    expect(lines[1]!.length).toBe(160);
    expect(lines[1]!.startsWith("02")).toBe(true);
  });

  it("batch control record (type 03) is exactly 160 chars", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    const batchCtrl = lines[lines.length - 2]!;
    expect(batchCtrl.length).toBe(160);
    expect(batchCtrl.startsWith("03")).toBe(true);
  });

  it("file control record (type 04) is exactly 160 chars", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    const fileCtrl = lines[lines.length - 1]!;
    expect(fileCtrl.length).toBe(160);
    expect(fileCtrl.startsWith("04")).toBe(true);
  });

  it("all records are exactly 160 chars with multiple beneficiaries", () => {
    const beneficiaries = Array.from({ length: 10 }, (_, i) =>
      makeBeneficiary({
        reference: `EMP${String(i).padStart(3, "0")}`,
        aadhaarNumber: `${String(100000000000 + i)}`,
      }),
    );
    const result = generateApbsFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i]!.length).toBe(160);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Aadhaar field — exactly 12 digits at correct position
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — Aadhaar field", () => {
  it("Aadhaar is exactly 12 digits at positions 9-20", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary({ aadhaarNumber: "987654321098" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Position 9-20 (0-indexed: 8-19)
    const aadhaarField = detail.slice(8, 20);
    expect(aadhaarField).toBe("987654321098");
    expect(aadhaarField.length).toBe(12);
  });

  it("Aadhaar field contains only digits", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary({ aadhaarNumber: "111222333444" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    const aadhaarField = detail.slice(8, 20);
    expect(aadhaarField).toMatch(/^\d{12}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// IIN field — exactly 6 digits at correct position
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — IIN field", () => {
  it("IIN is exactly 6 digits at positions 3-8", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary({ iin: "600123" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Position 3-8 (0-indexed: 2-7)
    const iinField = detail.slice(2, 8);
    expect(iinField).toBe("600123");
    expect(iinField.length).toBe(6);
  });

  it("IIN field contains only digits", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary({ iin: "999888" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    const iinField = detail.slice(2, 8);
    expect(iinField).toMatch(/^\d{6}$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Transaction code — "20" instead of "10"
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — transaction code", () => {
  it("header has transaction code '20' (not '10')", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    const header = lines[0]!;
    // ACH transaction code at positions 3-4 (0-indexed: 2-3)
    expect(header.slice(2, 4)).toBe("20");
  });

  it("detail records have transaction type '20' (not '10')", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Transaction type at positions 29-30 (0-indexed: 28-29)
    expect(detail.slice(28, 30)).toBe("20");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Validation — throws on missing/invalid Aadhaar
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — validation errors", () => {
  it("throws if beneficiary lacks Aadhaar (empty string)", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ aadhaarNumber: "" })],
      })),
    ).toThrow(/Aadhaar number is required/);
  });

  it("throws if Aadhaar is not exactly 12 digits (too short)", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ aadhaarNumber: "12345678" })],
      })),
    ).toThrow(/Aadhaar number must be exactly 12 digits/);
  });

  it("throws if Aadhaar is not exactly 12 digits (too long)", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ aadhaarNumber: "1234567890123" })],
      })),
    ).toThrow(/Aadhaar number must be exactly 12 digits/);
  });

  it("throws if Aadhaar contains non-digit characters", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ aadhaarNumber: "12345678ABCD" })],
      })),
    ).toThrow(/Aadhaar number must be exactly 12 digits/);
  });

  it("throws if IIN is not exactly 6 digits (too short)", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ iin: "123" })],
      })),
    ).toThrow(/IIN must be exactly 6 digits/);
  });

  it("throws if IIN is not exactly 6 digits (too long)", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ iin: "1234567" })],
      })),
    ).toThrow(/IIN must be exactly 6 digits/);
  });

  it("throws if IIN contains non-digit characters", () => {
    expect(() =>
      generateApbsFile(makeInput({
        beneficiaries: [makeBeneficiary({ iin: "ABC123" })],
      })),
    ).toThrow(/IIN must be exactly 6 digits/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRLF line endings
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — CRLF line endings", () => {
  it("uses CRLF (\\r\\n) as line separator", () => {
    const result = generateApbsFile(makeInput());
    expect(result.content).toContain("\r\n");
    // No bare \n without preceding \r
    const withoutCRLF = result.content.replace(/\r\n/g, "");
    expect(withoutCRLF).not.toContain("\n");
  });

  it("ends with CRLF", () => {
    const result = generateApbsFile(makeInput());
    expect(result.content.endsWith("\r\n")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// File structure — 1 beneficiary produces 4 lines
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — file structure", () => {
  it("file with 1 beneficiary produces exactly 4 lines", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary()],
    }));
    const lines = getLines(result.content);
    expect(lines).toHaveLength(4); // header + 1 detail + batch ctrl + file ctrl
  });

  it("file with 5 beneficiaries produces exactly 8 lines", () => {
    const beneficiaries = Array.from({ length: 5 }, (_, i) =>
      makeBeneficiary({
        reference: `EMP${i}`,
        aadhaarNumber: `${String(100000000000 + i)}`,
      }),
    );
    const result = generateApbsFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    expect(lines).toHaveLength(8); // header + 5 details + batch ctrl + file ctrl
  });

  it("record count in output matches beneficiary count", () => {
    const beneficiaries = Array.from({ length: 3 }, (_, i) =>
      makeBeneficiary({
        reference: `EMP${i}`,
        aadhaarNumber: `${String(200000000000 + i)}`,
      }),
    );
    const result = generateApbsFile(makeInput({ beneficiaries }));
    expect(result.recordCount).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Batch hash — sum of first 8 digits of Aadhaar numbers
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — batch hash", () => {
  it("batch hash is sum of first 8 digits of Aadhaar numbers mod 10^13", () => {
    const beneficiaries = [
      makeBeneficiary({ aadhaarNumber: "123456789012" }),
      makeBeneficiary({ aadhaarNumber: "987654321098", reference: "EMP002" }),
    ];
    // first 8: 12345678 + 98765432 = 111111110
    const expectedHash = (BigInt(12345678) + BigInt(98765432)) % 10_000_000_000_000n;

    const result = generateApbsFile(makeInput({ beneficiaries }));
    expect(result.batchHash).toBe(expectedHash);
  });

  it("batch hash in control record matches output batchHash", () => {
    const beneficiaries = [
      makeBeneficiary({ aadhaarNumber: "555555555000" }),
      makeBeneficiary({ aadhaarNumber: "111111111000", reference: "EMP002" }),
    ];
    const result = generateApbsFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    const batchCtrl = lines[lines.length - 2]!;
    // Batch hash at positions 24-36 (0-indexed: 23-35)
    const hashField = batchCtrl.slice(23, 36);
    const expected = result.batchHash.toString().padStart(13, "0");
    expect(hashField).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Detail record layout — filler at position 21-28
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — detail record layout", () => {
  it("filler at positions 21-28 is 8 spaces", () => {
    const result = generateApbsFile(makeInput());
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Position 21-28 (0-indexed: 20-27)
    const filler = detail.slice(20, 28);
    expect(filler).toBe("        "); // 8 spaces
  });

  it("amount is at positions 31-43 (zero-padded 13 digits)", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary({ amountMinor: 1234567n })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Amount at positions 31-43 (0-indexed: 30-42)
    const amountField = detail.slice(30, 43);
    expect(amountField).toBe("0000001234567");
  });

  it("beneficiary name is at positions 44-83 (40 chars, space-padded)", () => {
    const result = generateApbsFile(makeInput({
      beneficiaries: [makeBeneficiary({ name: "Sita Devi" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Name at positions 44-83 (0-indexed: 43-82)
    const nameField = detail.slice(43, 83);
    expect(nameField.length).toBe(40);
    expect(nameField).toBe("Sita Devi" + " ".repeat(31));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Filename pattern
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — filename", () => {
  it("follows pattern APBS_{sponsorCode}_{batchNumber}_{YYYYMMDD}.txt", () => {
    const result = generateApbsFile(makeInput({
      sponsorConfig: makeSponsorConfig({ sponsorCode: "SBIN" }),
      batchNumber: 2,
    }));
    expect(result.filename).toMatch(/^APBS_SBIN_2_\d{8}\.txt$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Output metadata
// ═══════════════════════════════════════════════════════════════════════════════
describe("apbs-writer — output metadata", () => {
  it("totalAmountMinor equals sum of all beneficiary amounts", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 100n }),
      makeBeneficiary({ amountMinor: 200n, reference: "EMP002", aadhaarNumber: "222222222222" }),
      makeBeneficiary({ amountMinor: 300n, reference: "EMP003", aadhaarNumber: "333333333333" }),
    ];
    const result = generateApbsFile(makeInput({ beneficiaries }));
    expect(result.totalAmountMinor).toBe(600n);
  });
});
