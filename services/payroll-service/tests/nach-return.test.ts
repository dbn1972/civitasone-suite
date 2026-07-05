/**
 * Tests for NACH Return File Parser.
 * Validates fixed-width parsing, structure validation, and status code extraction.
 */
import { describe, it, expect } from "vitest";
import { parseNachReturnFile, type NachReturnRecord } from "../src/modules/nach-return/parser.js";

const RECORD_WIDTH = 160;

/**
 * Helper: build a 160-char header record (type "01").
 */
function buildHeader(): string {
  return "01" + "10" + "SBIN000000" + "CR" + "04072026" + "05072026" +
    "HDFC0000012345 " + "NACH00000000012   " + " ".repeat(95);
}

/**
 * Helper: build a 160-char detail record (type "02") with status info.
 */
function buildDetail(opts: {
  reference?: string;
  amountMinor?: bigint;
  statusCode?: string;
  reasonCode?: string;
}): string {
  const recordType = "02";
  const ifsc = "SBIN0001234";    // pos 3-13 (11 chars)
  const account = "123456789012345"; // pos 14-28 (15 chars)
  const txType = "10";           // pos 29-30 (2 chars)
  const amount = (opts.amountMinor ?? 5000000n).toString().padStart(13, "0"); // pos 31-43 (13 chars)
  const name = "Test Employee".padEnd(40, " "); // pos 44-83 (40 chars)
  const reference = (opts.reference ?? "EMP001").padEnd(20, " "); // pos 84-103 (20 chars)
  const narration = "Salary 2026-07 EMP001".padEnd(40, " "); // pos 104-143 (40 chars)
  // pos 144-145: status code (2 chars), pos 146-149: reason code (4 chars)
  const statusCode = (opts.statusCode ?? "0 ").padEnd(2, " ");
  const reasonCode = (opts.reasonCode ?? "    ").padEnd(4, " ");
  // pos 150-160: remaining filler (11 chars)
  const filler = " ".repeat(11);

  const record = recordType + ifsc + account + txType + amount + name + reference + narration + statusCode + reasonCode + filler;
  // Ensure exactly 160 chars
  return record.padEnd(RECORD_WIDTH, " ").slice(0, RECORD_WIDTH);
}

/**
 * Helper: build batch control record (type "03").
 */
function buildBatchControl(count: number, totalAmount: bigint): string {
  const recordType = "03";
  const countStr = count.toString().padStart(8, "0");
  const amountStr = totalAmount.toString().padStart(13, "0");
  const hash = "0000000000000";
  const filler = " ".repeat(124);
  return (recordType + countStr + amountStr + hash + filler).slice(0, RECORD_WIDTH);
}

/**
 * Helper: build file control record (type "04").
 */
function buildFileControl(batchCount: number, totalRecords: number, grandTotal: bigint): string {
  const recordType = "04";
  const batches = batchCount.toString().padStart(4, "0");
  const records = totalRecords.toString().padStart(8, "0");
  const amount = grandTotal.toString().padStart(13, "0");
  const filler = " ".repeat(133);
  return (recordType + batches + records + amount + filler).slice(0, RECORD_WIDTH);
}

/**
 * Helper: assemble a complete NACH return file from lines.
 */
function assembleFile(lines: string[]): string {
  return lines.join("\r\n") + "\r\n";
}

describe("parseNachReturnFile", () => {
  it("correctly reads credited status (statusCode '0')", () => {
    const content = assembleFile([
      buildHeader(),
      buildDetail({ reference: "EMP001", amountMinor: 5000000n, statusCode: "0 " }),
      buildBatchControl(1, 5000000n),
      buildFileControl(1, 1, 5000000n),
    ]);

    const records = parseNachReturnFile(content);
    expect(records).toHaveLength(1);
    expect(records[0]!.reference).toBe("EMP001");
    expect(records[0]!.amountMinor).toBe(5000000n);
    expect(records[0]!.statusCode).toBe("0");
    expect(records[0]!.reasonCode).toBe("");
    expect(records[0]!.reasonText).toBe("");
  });

  it("correctly reads returned status with reason code", () => {
    const content = assembleFile([
      buildHeader(),
      buildDetail({ reference: "EMP002", amountMinor: 3000000n, statusCode: "1 ", reasonCode: "01  " }),
      buildBatchControl(1, 3000000n),
      buildFileControl(1, 1, 3000000n),
    ]);

    const records = parseNachReturnFile(content);
    expect(records).toHaveLength(1);
    expect(records[0]!.statusCode).toBe("1");
    expect(records[0]!.reasonCode).toBe("01");
    expect(records[0]!.reasonText).toBe("Account closed");
  });

  it("parses multiple detail records with mixed statuses", () => {
    const content = assembleFile([
      buildHeader(),
      buildDetail({ reference: "EMP001", amountMinor: 5000000n, statusCode: "0 " }),
      buildDetail({ reference: "EMP002", amountMinor: 3000000n, statusCode: "1 ", reasonCode: "03  " }),
      buildDetail({ reference: "EMP003", amountMinor: 4500000n, statusCode: "0 " }),
      buildDetail({ reference: "EMP004", amountMinor: 6000000n, statusCode: "1 ", reasonCode: "04  " }),
      buildBatchControl(4, 18500000n),
      buildFileControl(1, 4, 18500000n),
    ]);

    const records = parseNachReturnFile(content);
    expect(records).toHaveLength(4);

    // Verify credited
    expect(records[0]!.statusCode).toBe("0");
    expect(records[2]!.statusCode).toBe("0");

    // Verify returned with reasons
    expect(records[1]!.statusCode).toBe("1");
    expect(records[1]!.reasonText).toBe("Name mismatch");
    expect(records[3]!.statusCode).toBe("1");
    expect(records[3]!.reasonText).toBe("IFSC invalid");
  });

  it("throws on invalid file structure - missing header", () => {
    const content = assembleFile([
      buildDetail({ reference: "EMP001" }),
      buildBatchControl(1, 5000000n),
      buildFileControl(1, 1, 5000000n),
    ]);

    expect(() => parseNachReturnFile(content)).toThrow("INVALID_RETURN_FILE");
  });

  it("throws on invalid file structure - wrong header type", () => {
    const content = assembleFile([
      "99" + " ".repeat(158),
      buildDetail({ reference: "EMP001" }),
      buildBatchControl(1, 5000000n),
      buildFileControl(1, 1, 5000000n),
    ]);

    expect(() => parseNachReturnFile(content)).toThrow("first record must be type '01'");
  });

  it("throws on empty file", () => {
    expect(() => parseNachReturnFile("")).toThrow("INVALID_RETURN_FILE");
  });

  it("throws when file has only header and no details", () => {
    const content = assembleFile([
      buildHeader(),
      buildBatchControl(0, 0n),
      buildFileControl(1, 0, 0n),
    ]);

    expect(() => parseNachReturnFile(content)).toThrow("no detail records found");
  });

  it("throws on unexpected record type between details", () => {
    const content = assembleFile([
      buildHeader(),
      buildDetail({ reference: "EMP001" }),
      "99" + " ".repeat(158),
      buildBatchControl(1, 5000000n),
      buildFileControl(1, 1, 5000000n),
    ]);

    expect(() => parseNachReturnFile(content)).toThrow("unexpected record type '99'");
  });

  it("handles unknown reason codes gracefully", () => {
    const content = assembleFile([
      buildHeader(),
      buildDetail({ reference: "EMP001", statusCode: "1 ", reasonCode: "ZZ  " }),
      buildBatchControl(1, 5000000n),
      buildFileControl(1, 1, 5000000n),
    ]);

    const records = parseNachReturnFile(content);
    expect(records[0]!.reasonText).toBe("Unknown reason (ZZ)");
  });

  it("handles LF line endings (not just CRLF)", () => {
    const lines = [
      buildHeader(),
      buildDetail({ reference: "EMP001", amountMinor: 1000n, statusCode: "0 " }),
      buildBatchControl(1, 1000n),
      buildFileControl(1, 1, 1000n),
    ];
    const content = lines.join("\n") + "\n";

    const records = parseNachReturnFile(content);
    expect(records).toHaveLength(1);
    expect(records[0]!.reference).toBe("EMP001");
  });
});
