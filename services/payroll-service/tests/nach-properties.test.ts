/**
 * Property-Based Tests for NACH file generation.
 * Uses fast-check to verify invariants hold across all valid inputs.
 *
 * **Validates: Requirements R1.1, R1.4, R3.3**
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { generateNachFile, type NachFileInput } from "../src/modules/bank-transfer/nach-writer.js";
import { splitIntoBatches, computeBatchHash, type NachBeneficiary } from "../src/modules/bank-transfer/domain.js";
import type { SponsorBankConfigRow } from "../src/modules/sponsor-config/schema.js";

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const beneficiaryArb: fc.Arbitrary<NachBeneficiary> = fc.record({
  ifsc: fc.stringMatching(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  accountNo: fc.stringMatching(/^[0-9]{5,15}$/),
  // Max amount per beneficiary capped so that batch totals stay within
  // the 13-digit NACH field width (max 9999999999999 paise).
  // With up to 1000 beneficiaries, cap individual at ~9.9B paise.
  amountMinor: fc.bigInt({ min: 1n, max: 9999999n }),
  name: fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.replace(/[^\x20-\x7E]/g, "A")),
  reference: fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.replace(/[^\x20-\x7E]/g, "A")),
  narration: fc.string({ minLength: 1, maxLength: 40 }).map((s) => s.replace(/[^\x20-\x7E]/g, "A")),
});

/** Stub sponsor config for test purposes. */
function makeSponsorConfig(): SponsorBankConfigRow {
  return {
    tenantId: "00000000-0000-0000-0000-000000000001",
    sponsorCode: "HDFC",
    sponsorIfsc: "HDFC0000001",
    sponsorAccount: "1234567890" as unknown as string,
    utilityCode: "NACH00000000012",
    userNumber: "USER12345",
    settlementOffsetDays: 1,
    nachEnabled: true,
    apbsEnabled: false,
    maxRecordsPerFile: 100000,
    maxAmountPerFileMinor: 10000000000n,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: "00000000-0000-0000-0000-000000000002",
    updatedBy: "00000000-0000-0000-0000-000000000002",
  };
}

// ─── Property Tests ───────────────────────────────────────────────────────────

describe("NACH Property-Based Tests", () => {
  /**
   * Property 1: Control total invariant.
   * For any valid beneficiary list, the file control grand total equals the
   * sum of all detail amounts.
   *
   * **Validates: Requirements R1.1, R1.4**
   */
  it("control total invariant: file grand total equals sum of all detail amounts", () => {
    fc.assert(
      fc.property(
        fc.array(beneficiaryArb, { minLength: 1, maxLength: 1000 }),
        (beneficiaries) => {
          const input: NachFileInput = {
            sponsorConfig: makeSponsorConfig(),
            settlementDate: "05072026",
            beneficiaries,
            batchNumber: 1,
          };

          const output = generateNachFile(input);

          // Compute expected total from input
          const expectedTotal = beneficiaries.reduce((sum, b) => sum + b.amountMinor, 0n);
          expect(output.totalAmountMinor).toBe(expectedTotal);

          // Also verify by parsing the file control record (last line)
          const lines = output.content.split("\r\n").filter((l) => l.length > 0);
          const fileControlLine = lines[lines.length - 1]!;
          // File control: type "04" (2) + batch count (4) + record count (8) + grand total (13)
          const grandTotalStr = fileControlLine.slice(14, 27);
          expect(BigInt(grandTotalStr)).toBe(expectedTotal);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 2: Line length invariant.
   * Every line in generated output is exactly 160 characters.
   *
   * **Validates: Requirements R1.1**
   */
  it("line length invariant: every line is exactly 160 characters", () => {
    fc.assert(
      fc.property(
        fc.array(beneficiaryArb, { minLength: 1, maxLength: 500 }),
        (beneficiaries) => {
          const input: NachFileInput = {
            sponsorConfig: makeSponsorConfig(),
            settlementDate: "05072026",
            beneficiaries,
            batchNumber: 1,
          };

          const output = generateNachFile(input);
          // Split on CRLF; the content ends with a trailing CRLF so filter empty last element
          const lines = output.content.split("\r\n").filter((l) => l.length > 0);

          for (const line of lines) {
            expect(line.length).toBe(160);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 3: Batch hash determinism.
   * Same input always produces the same hash.
   *
   * **Validates: Requirements R1.1**
   */
  it("batch hash determinism: same input produces same hash", () => {
    fc.assert(
      fc.property(
        fc.array(beneficiaryArb, { minLength: 1, maxLength: 500 }),
        (beneficiaries) => {
          const hash1 = computeBatchHash(beneficiaries);
          const hash2 = computeBatchHash(beneficiaries);
          expect(hash1).toBe(hash2);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 4: Line count invariant.
   * Number of lines = 1 (header) + N (details) + 1 (batch ctrl) + 1 (file ctrl).
   *
   * **Validates: Requirements R1.1**
   */
  it("line count invariant: lines = 1 header + N details + 1 batch ctrl + 1 file ctrl", () => {
    fc.assert(
      fc.property(
        fc.array(beneficiaryArb, { minLength: 1, maxLength: 1000 }),
        (beneficiaries) => {
          const input: NachFileInput = {
            sponsorConfig: makeSponsorConfig(),
            settlementDate: "05072026",
            beneficiaries,
            batchNumber: 1,
          };

          const output = generateNachFile(input);
          const lines = output.content.split("\r\n").filter((l) => l.length > 0);

          // Expected: 1 header + N details + 1 batch control + 1 file control
          const expectedLineCount = 1 + beneficiaries.length + 1 + 1;
          expect(lines.length).toBe(expectedLineCount);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Property 5: Split preservation.
   * splitIntoBatches then flatten preserves all beneficiaries — no loss, no duplication.
   *
   * **Validates: Requirements R3.3**
   */
  it("split preservation: splitIntoBatches then flatten preserves all beneficiaries", () => {
    fc.assert(
      fc.property(
        fc.array(beneficiaryArb, { minLength: 1, maxLength: 1000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.bigInt({ min: 100000n, max: 99999999999n }),
        (beneficiaries, maxRecords, maxAmount) => {
          const batches = splitIntoBatches(beneficiaries, maxRecords, maxAmount);
          const flattened = batches.flat();

          // No loss: every input beneficiary appears in the output
          expect(flattened.length).toBe(beneficiaries.length);

          // No duplication: references match in order
          for (let i = 0; i < beneficiaries.length; i++) {
            expect(flattened[i]!.reference).toBe(beneficiaries[i]!.reference);
            expect(flattened[i]!.amountMinor).toBe(beneficiaries[i]!.amountMinor);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
