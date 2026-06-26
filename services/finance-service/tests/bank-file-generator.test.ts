/**
 * Contract tests for the NACH/NEFT fixed-width bank file generator.
 *
 * Asserts exact field positions in header, detail, and trailer records so that
 * any regression in the file format is caught before files reach PFMS/NPCI.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  generateNACHFile,
  type BankFileRow,
  buildHeaderRecord,
  buildDetailRecord,
  buildTrailerRecord,
  toDDMMYYYY,
} from "../src/modules/integrations/bank-file-generator.js";

// ── helpers ───────────────────────────────────────────────────────────────────

const FIXED_DATE = "2024-07-01"; // YYYY-MM-DD

function makeRow(overrides: Partial<BankFileRow> = {}): BankFileRow {
  return {
    ifsc: "SBIN0001234",
    accountNo: "12345678901234",
    accountName: "Bharat Construction Pvt",
    amountMinor: 100050n, // ₹1000.50 in paise
    narration: "GRANT/PFMS-001",
    paymentDate: FIXED_DATE,
    ...overrides,
  };
}

// ── toDDMMYYYY ───────────────────────────────────────────────────────────────

describe("toDDMMYYYY", () => {
  it("converts YYYY-MM-DD to DDMMYYYY", () => {
    expect(toDDMMYYYY("2024-07-01")).toBe("01072024");
    expect(toDDMMYYYY("2024-12-31")).toBe("31122024");
  });

  it("throws on invalid format", () => {
    expect(() => toDDMMYYYY("20240701")).toThrow();
  });
});

// ── Header record ─────────────────────────────────────────────────────────────

describe("buildHeaderRecord", () => {
  it("starts with record type '0'", () => {
    const header = buildHeaderRecord({
      originatorCode: "AG001",
      valueDate: FIXED_DATE,
      fileSequenceNo: 1,
      totalRecords: 3,
    });
    expect(header[0]).toBe("0");
  });

  it("encodes originator code at positions 2–17 (right-padded to 16 chars)", () => {
    const header = buildHeaderRecord({
      originatorCode: "AG001",
      valueDate: FIXED_DATE,
      fileSequenceNo: 1,
      totalRecords: 1,
    });
    // Pos 2–17 (0-indexed: 1–16) = originator code, 16 chars
    const originatorField = header.slice(1, 17);
    expect(originatorField).toBe("AG001           "); // padded to 16
    expect(originatorField.length).toBe(16);
  });

  it("encodes value date at positions 18–33 (DDMMYYYY, padded to 16)", () => {
    const header = buildHeaderRecord({
      originatorCode: "AG001",
      valueDate: FIXED_DATE, // 2024-07-01 → 01072024
      fileSequenceNo: 1,
      totalRecords: 1,
    });
    const valueDateField = header.slice(17, 33);
    expect(valueDateField.startsWith("01072024")).toBe(true);
    expect(valueDateField.length).toBe(16);
  });

  it("encodes file sequence number at positions 42–49 (8 digits zero-padded)", () => {
    const header = buildHeaderRecord({
      originatorCode: "AG001",
      valueDate: FIXED_DATE,
      fileSequenceNo: 42,
      totalRecords: 5,
    });
    const seqField = header.slice(41, 49);
    expect(seqField).toBe("00000042");
  });

  it("encodes total record count at positions 50–56 (7 digits zero-padded)", () => {
    const header = buildHeaderRecord({
      originatorCode: "AG001",
      valueDate: FIXED_DATE,
      fileSequenceNo: 1,
      totalRecords: 99,
    });
    const countField = header.slice(49, 56);
    expect(countField).toBe("0000099");
  });

  it("truncates originator code > 16 chars", () => {
    const header = buildHeaderRecord({
      originatorCode: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", // 26 chars
      valueDate: FIXED_DATE,
      fileSequenceNo: 1,
      totalRecords: 1,
    });
    expect(header.slice(1, 17).length).toBe(16);
  });
});

// ── Detail record ─────────────────────────────────────────────────────────────

describe("buildDetailRecord", () => {
  it("starts with record type '1'", () => {
    const detail = buildDetailRecord(makeRow());
    expect(detail[0]).toBe("1");
  });

  it("encodes IFSC at positions 2–12 (11 chars)", () => {
    const detail = buildDetailRecord(makeRow({ ifsc: "HDFC0003210" }));
    const ifscField = detail.slice(1, 12);
    expect(ifscField).toBe("HDFC0003210");
    expect(ifscField.length).toBe(11);
  });

  it("encodes account number at positions 13–30 (18 chars, right-padded)", () => {
    const detail = buildDetailRecord(makeRow({ accountNo: "123456789" }));
    const acctField = detail.slice(12, 30);
    expect(acctField).toBe("123456789         "); // padded to 18
    expect(acctField.length).toBe(18);
  });

  it("encodes amount in paise at positions 31–47 (17 digits, zero-padded)", () => {
    const detail = buildDetailRecord(makeRow({ amountMinor: 100050n }));
    const amtField = detail.slice(30, 47);
    expect(amtField).toBe("00000000000100050");
    expect(amtField.length).toBe(17);
  });

  it("encodes account name at positions 48–82 (35 chars)", () => {
    const detail = buildDetailRecord(makeRow({ accountName: "Ram Prasad" }));
    const nameField = detail.slice(47, 82);
    expect(nameField).toBe("Ram Prasad                         "); // padded to 35
    expect(nameField.length).toBe(35);
  });

  it("encodes narration at positions 83–107 (25 chars)", () => {
    const detail = buildDetailRecord(makeRow({ narration: "GRANT/12345" }));
    const narField = detail.slice(82, 107);
    expect(narField).toBe("GRANT/12345              "); // padded to 25
    expect(narField.length).toBe(25);
  });

  it("encodes payment date at positions 108–115 (DDMMYYYY, 8 chars)", () => {
    const detail = buildDetailRecord(makeRow({ paymentDate: "2024-07-01" }));
    const dateField = detail.slice(107, 115);
    expect(dateField).toBe("01072024");
    expect(dateField.length).toBe(8);
  });

  it("total record length is exactly 115 chars", () => {
    const detail = buildDetailRecord(makeRow());
    expect(detail.length).toBe(115);
  });
});

// ── Trailer record ────────────────────────────────────────────────────────────

describe("buildTrailerRecord", () => {
  it("starts with record type '9'", () => {
    const trailer = buildTrailerRecord(5, 500000n);
    expect(trailer[0]).toBe("9");
  });

  it("encodes detail count at positions 2–8 (7 digits)", () => {
    const trailer = buildTrailerRecord(7, 0n);
    expect(trailer.slice(1, 8)).toBe("0000007");
  });

  it("encodes total amount in paise at positions 9–25 (17 digits)", () => {
    const trailer = buildTrailerRecord(1, 999999999999999n);
    expect(trailer.slice(8, 25)).toBe("00999999999999999");
  });
});

// ── generateNACHFile ──────────────────────────────────────────────────────────

describe("generateNACHFile", () => {
  const row = makeRow();

  it("returns a string containing CRLF-delimited lines", () => {
    const file = generateNACHFile([row], { valueDate: FIXED_DATE, originatorCode: "AG001" });
    expect(file).toContain("\r\n");
  });

  it("has exactly 3 lines for a single payment (header + 1 detail + trailer)", () => {
    const file = generateNACHFile([row], { valueDate: FIXED_DATE });
    const lines = file.split("\r\n");
    expect(lines.length).toBe(3);
  });

  it("first line starts with '0' (header record type)", () => {
    const file = generateNACHFile([row], { valueDate: FIXED_DATE });
    const [header] = file.split("\r\n");
    expect(header![0]).toBe("0");
  });

  it("second line starts with '1' (detail record type)", () => {
    const file = generateNACHFile([row], { valueDate: FIXED_DATE });
    const lines = file.split("\r\n");
    expect(lines[1]![0]).toBe("1");
  });

  it("last line starts with '9' (trailer record type)", () => {
    const file = generateNACHFile([row], { valueDate: FIXED_DATE });
    const lines = file.split("\r\n");
    expect(lines[lines.length - 1]![0]).toBe("9");
  });

  it("trailer encodes the correct total amount (paise)", () => {
    const file = generateNACHFile([row], { valueDate: FIXED_DATE }); // 100050n
    const lines = file.split("\r\n");
    const trailer = lines[lines.length - 1]!;
    // Positions 9–25 (0-indexed 8–24): total paise
    expect(trailer.slice(8, 25)).toBe("00000000000100050");
  });

  it("sums multiple rows correctly in trailer", () => {
    const row2 = makeRow({ amountMinor: 200000n });
    const file = generateNACHFile([row, row2], { valueDate: FIXED_DATE }); // 300050n
    const lines = file.split("\r\n");
    expect(lines.length).toBe(4); // header + 2 detail + trailer
    const trailer = lines[lines.length - 1]!;
    expect(trailer.slice(8, 25)).toBe("00000000000300050");
    // detail count
    expect(trailer.slice(1, 8)).toBe("0000002");
  });

  it("throws for empty payment array", () => {
    expect(() => generateNACHFile([])).toThrow("must not be empty");
  });

  it("throws for non-positive amountMinor", () => {
    expect(() => generateNACHFile([makeRow({ amountMinor: 0n })])).toThrow("amountMinor must be > 0");
  });

  it("uses SFTP_NACH_ORIGINATOR env var as originator code when not passed", () => {
    process.env["SFTP_NACH_ORIGINATOR"] = "ENVAGENCY";
    const file = generateNACHFile([row], { valueDate: FIXED_DATE });
    const [header] = file.split("\r\n");
    expect(header!.slice(1, 17)).toBe("ENVAGENCY       ");
    delete process.env["SFTP_NACH_ORIGINATOR"];
  });

  it("header record has correct originator at positions 2–17 (56+ chars)", () => {
    const file = generateNACHFile([row], { originatorCode: "PFMSAG01", valueDate: FIXED_DATE });
    const [header] = file.split("\r\n");
    expect(header!.slice(1, 17)).toBe("PFMSAG01        ");
    expect(header!.length).toBeGreaterThanOrEqual(56);
  });
});

// ── sftp-egress: buildRemotePath ──────────────────────────────────────────────

describe("buildRemotePath", () => {
  it("constructs <baseDir>/<YYYY-MM-DD>/<filename>", async () => {
    const { buildRemotePath } = await import(
      "../src/modules/integrations/sftp-egress.js"
    );
    const date = new Date("2024-07-01T10:00:00Z");
    const result = buildRemotePath("/upload/agency/AG001", "NACH_batch_001.txt", date);
    expect(result).toBe("/upload/agency/AG001/2024-07-01/NACH_batch_001.txt");
  });

  it("strips trailing slash from baseDir", async () => {
    const { buildRemotePath } = await import(
      "../src/modules/integrations/sftp-egress.js"
    );
    const date = new Date("2024-12-31T00:00:00Z");
    const result = buildRemotePath("/upload/", "file.txt", date);
    expect(result).toBe("/upload/2024-12-31/file.txt");
  });
});

// ── sftp-egress: readSftpConfig ────────────────────────────────────────────────

describe("readSftpConfig", () => {
  it("returns null when SFTP_HOST is not set", async () => {
    const saved = process.env["SFTP_HOST"];
    delete process.env["SFTP_HOST"];
    const { readSftpConfig } = await import("../src/modules/integrations/sftp-egress.js");
    expect(readSftpConfig()).toBeNull();
    if (saved !== undefined) process.env["SFTP_HOST"] = saved;
  });

  it("throws when SFTP_HOST set but companion vars missing", async () => {
    process.env["SFTP_HOST"] = "sftp.pfms.gov.in";
    delete process.env["SFTP_USER"];
    delete process.env["SFTP_KEY_PATH"];
    delete process.env["SFTP_REMOTE_DIR"];
    const { readSftpConfig } = await import("../src/modules/integrations/sftp-egress.js");
    expect(() => readSftpConfig()).toThrow("SFTP_USER");
    delete process.env["SFTP_HOST"];
  });
});
