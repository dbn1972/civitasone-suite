/**
 * Unit tests for NACH ACH-CR file writer.
 * Validates fixed-width formatting, record lengths, amounts, and CRLF line endings.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { generateNachFile, type NachFileInput, type NachFileOutput } from "../src/modules/bank-transfer/nach-writer.js";
import { computeBatchHash, type NachBeneficiary } from "../src/modules/bank-transfer/domain.js";
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
    apbsEnabled: false,
    maxRecordsPerFile: 100000,
    maxAmountPerFileMinor: 1000000000n,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "00000000-0000-0000-0000-000000000002",
    updatedBy: "00000000-0000-0000-0000-000000000002",
    ...overrides,
  };
}

function makeBeneficiary(overrides?: Partial<NachBeneficiary>): NachBeneficiary {
  return {
    ifsc: "SBIN0001234",
    accountNo: "12345678901",
    amountMinor: 5000000n, // ₹50,000
    name: "Rajesh Kumar",
    reference: "EMP001",
    narration: "Salary Jun 2026",
    ...overrides,
  };
}

function makeInput(overrides?: Partial<NachFileInput>): NachFileInput {
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
  // Split by CRLF, filter out trailing empty line
  return content.split("\r\n").filter((line) => line.length > 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Record Length Validation — Every line must be EXACTLY 160 chars
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — record length (160 chars)", () => {
  it("header record (type 01) is exactly 160 chars", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    expect(lines[0]!.length).toBe(160);
    expect(lines[0]!.startsWith("01")).toBe(true);
  });

  it("detail record (type 02) is exactly 160 chars", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    expect(lines[1]!.length).toBe(160);
    expect(lines[1]!.startsWith("02")).toBe(true);
  });

  it("batch control record (type 03) is exactly 160 chars", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    const batchCtrl = lines[lines.length - 2]!;
    expect(batchCtrl.length).toBe(160);
    expect(batchCtrl.startsWith("03")).toBe(true);
  });

  it("file control record (type 04) is exactly 160 chars", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    const fileCtrl = lines[lines.length - 1]!;
    expect(fileCtrl.length).toBe(160);
    expect(fileCtrl.startsWith("04")).toBe(true);
  });

  it("all records are exactly 160 chars with multiple beneficiaries", () => {
    const beneficiaries = Array.from({ length: 10 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${String(i).padStart(3, "0")}` }),
    );
    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i]!.length).toBe(160);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Amount Formatting — zero-padded 13 digits
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — amount formatting", () => {
  it("formats zero amount as 13 zeros", () => {
    // Zero amount beneficiary (though validation would normally reject this)
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ amountMinor: 0n })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Amount field is at positions 31-43 (0-indexed: 30-42)
    const amountField = detail.slice(30, 43);
    expect(amountField).toBe("0000000000000");
  });

  it("formats max 13-digit amount (9999999999999 paise)", () => {
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ amountMinor: 9999999999999n })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    const amountField = detail.slice(30, 43);
    expect(amountField).toBe("9999999999999");
  });

  it("formats ₹10 crore (1000000000 paise) correctly", () => {
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ amountMinor: 1000000000n })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    const amountField = detail.slice(30, 43);
    expect(amountField).toBe("0001000000000");
  });

  it("batch control total matches sum of detail amounts", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 5000000n }),
      makeBeneficiary({ amountMinor: 3000000n, reference: "EMP002" }),
    ];
    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    const batchCtrl = lines[lines.length - 2]!;
    // Total amount at positions 11-23 (0-indexed: 10-22)
    const totalField = batchCtrl.slice(10, 23);
    const expected = (5000000n + 3000000n).toString().padStart(13, "0");
    expect(totalField).toBe(expected);
  });

  it("file control grand total matches sum of all detail amounts", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 1000000n }),
      makeBeneficiary({ amountMinor: 2000000n, reference: "EMP002" }),
      makeBeneficiary({ amountMinor: 3000000n, reference: "EMP003" }),
    ];
    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    const fileCtrl = lines[lines.length - 1]!;
    // Grand total at positions 15-27 (0-indexed: 14-26)
    const totalField = fileCtrl.slice(14, 27);
    const expected = (1000000n + 2000000n + 3000000n).toString().padStart(13, "0");
    expect(totalField).toBe(expected);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Header date format
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — header fields", () => {
  it("settlement date is embedded in header at positions 25-32", () => {
    const result = generateNachFile(makeInput({ settlementDate: "05072026" }));
    const lines = getLines(result.content);
    const header = lines[0]!;
    // Settlement date at positions 25-32 (0-indexed: 24-31)
    const settDate = header.slice(24, 32);
    expect(settDate).toBe("05072026");
  });

  it("creation date at positions 17-24 is DDMMYYYY format (8 digits)", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    const header = lines[0]!;
    // Creation date at positions 17-24 (0-indexed: 16-23)
    const creationDate = header.slice(16, 24);
    // Should be 8 digits in DDMMYYYY format
    expect(creationDate).toMatch(/^\d{8}$/);
    // Day part (01-31)
    const day = parseInt(creationDate.slice(0, 2), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
    // Month part (01-12)
    const month = parseInt(creationDate.slice(2, 4), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("destination bank is first 4 chars of IFSC + 6 zeros", () => {
    const result = generateNachFile(makeInput({
      sponsorConfig: makeSponsorConfig({ sponsorIfsc: "SBIN0005432" }),
    }));
    const lines = getLines(result.content);
    const header = lines[0]!;
    // Destination bank at positions 5-14 (0-indexed: 4-13)
    const destBank = header.slice(4, 14);
    expect(destBank).toBe("SBIN000000");
  });

  it("record type is '01' and ACH code is '10'", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    const header = lines[0]!;
    expect(header.slice(0, 2)).toBe("01");
    expect(header.slice(2, 4)).toBe("10");
  });

  it("file type is 'CR' at positions 15-16", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    const header = lines[0]!;
    expect(header.slice(14, 16)).toBe("CR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Batch hash
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — batch hash", () => {
  it("batch hash in control record matches manual computeBatchHash calculation", () => {
    const beneficiaries = [
      makeBeneficiary({ accountNo: "12345678901" }),
      makeBeneficiary({ accountNo: "98765432100", reference: "EMP002" }),
    ];
    const expectedHash = computeBatchHash(beneficiaries);

    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    const batchCtrl = lines[lines.length - 2]!;
    // Batch hash at positions 24-36 (0-indexed: 23-35)
    const hashField = batchCtrl.slice(23, 36);
    const expected = expectedHash.toString().padStart(13, "0");
    expect(hashField).toBe(expected);
  });

  it("output batchHash field matches computeBatchHash", () => {
    const beneficiaries = [
      makeBeneficiary({ accountNo: "55555555000" }),
      makeBeneficiary({ accountNo: "11111111000", reference: "EMP002" }),
    ];
    const expectedHash = computeBatchHash(beneficiaries);

    const result = generateNachFile(makeInput({ beneficiaries }));
    expect(result.batchHash).toBe(expectedHash);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — file structure", () => {
  it("file with 1 beneficiary produces exactly 4 lines", () => {
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary()],
    }));
    const lines = getLines(result.content);
    expect(lines).toHaveLength(4); // header + 1 detail + batch ctrl + file ctrl
  });

  it("file with 5 beneficiaries produces exactly 8 lines", () => {
    const beneficiaries = Array.from({ length: 5 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${i}` }),
    );
    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    expect(lines).toHaveLength(8); // header + 5 details + batch ctrl + file ctrl
  });

  it("record count in output matches beneficiary count", () => {
    const beneficiaries = Array.from({ length: 3 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${i}` }),
    );
    const result = generateNachFile(makeInput({ beneficiaries }));
    expect(result.recordCount).toBe(3);
  });

  it("batch control record count field matches detail record count", () => {
    const beneficiaries = Array.from({ length: 7 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${i}` }),
    );
    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    const batchCtrl = lines[lines.length - 2]!;
    // Record count at positions 3-10 (0-indexed: 2-9)
    const countField = batchCtrl.slice(2, 10);
    expect(countField).toBe("00000007");
  });

  it("file control batch count is always '0001'", () => {
    const result = generateNachFile(makeInput());
    const lines = getLines(result.content);
    const fileCtrl = lines[lines.length - 1]!;
    // Batch count at positions 3-6 (0-indexed: 2-5)
    expect(fileCtrl.slice(2, 6)).toBe("0001");
  });

  it("file control detail record count matches", () => {
    const beneficiaries = Array.from({ length: 4 }, (_, i) =>
      makeBeneficiary({ reference: `EMP${i}` }),
    );
    const result = generateNachFile(makeInput({ beneficiaries }));
    const lines = getLines(result.content);
    const fileCtrl = lines[lines.length - 1]!;
    // Detail record count at positions 7-14 (0-indexed: 6-13)
    expect(fileCtrl.slice(6, 14)).toBe("00000004");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CRLF line endings
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — CRLF line endings", () => {
  it("uses CRLF (\\r\\n) as line separator", () => {
    const result = generateNachFile(makeInput());
    // Should contain \r\n
    expect(result.content).toContain("\r\n");
    // Should NOT contain bare \n without \r
    const withoutCRLF = result.content.replace(/\r\n/g, "");
    expect(withoutCRLF).not.toContain("\n");
  });

  it("ends with CRLF", () => {
    const result = generateNachFile(makeInput());
    expect(result.content.endsWith("\r\n")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Name truncation and padding
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — name truncation and padding", () => {
  it("names longer than 40 chars are truncated to 40", () => {
    const longName = "A".repeat(60);
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ name: longName })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Name at positions 44-83 (0-indexed: 43-82)
    const nameField = detail.slice(43, 83);
    expect(nameField.length).toBe(40);
    expect(nameField).toBe("A".repeat(40));
  });

  it("short names are space-padded to 40 chars", () => {
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ name: "AB" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    const nameField = detail.slice(43, 83);
    expect(nameField.length).toBe(40);
    expect(nameField).toBe("AB" + " ".repeat(38));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Account number padding
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — account number padding", () => {
  it("short account numbers are left-justified, space-padded to 15 chars", () => {
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ accountNo: "123" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    // Account at positions 14-28 (0-indexed: 13-27)
    const accountField = detail.slice(13, 28);
    expect(accountField.length).toBe(15);
    expect(accountField).toBe("123            ");
  });

  it("15-char account numbers fill the field exactly", () => {
    const result = generateNachFile(makeInput({
      beneficiaries: [makeBeneficiary({ accountNo: "123456789012345" })],
    }));
    const lines = getLines(result.content);
    const detail = lines[1]!;
    const accountField = detail.slice(13, 28);
    expect(accountField.length).toBe(15);
    expect(accountField).toBe("123456789012345");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Filename pattern
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — filename", () => {
  it("follows pattern NACH_{sponsorCode}_{batchNumber}_{YYYYMMDD}.txt", () => {
    const result = generateNachFile(makeInput({
      sponsorConfig: makeSponsorConfig({ sponsorCode: "SBIN" }),
      batchNumber: 3,
    }));
    // Pattern: NACH_SBIN_3_YYYYMMDD.txt
    expect(result.filename).toMatch(/^NACH_SBIN_3_\d{8}\.txt$/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Output metadata
// ═══════════════════════════════════════════════════════════════════════════════
describe("nach-writer — output metadata", () => {
  it("totalAmountMinor equals sum of all beneficiary amounts", () => {
    const beneficiaries = [
      makeBeneficiary({ amountMinor: 100n }),
      makeBeneficiary({ amountMinor: 200n, reference: "EMP002" }),
      makeBeneficiary({ amountMinor: 300n, reference: "EMP003" }),
    ];
    const result = generateNachFile(makeInput({ beneficiaries }));
    expect(result.totalAmountMinor).toBe(600n);
  });
});
