import { describe, it, expect } from "vitest";
import {
  parseContactCsv,
  isValidMobile,
  isValidEmail,
  parseConsent,
} from "./contactImport";

const HEADER = "name,email,phone,company,leadStatus,marketingConsent";

describe("parseContactCsv (GAP-CRM-CONTACTS-IMPORT-01)", () => {
  it("rejects an invalid lead status instead of casting it through", () => {
    const { rows, rejected } = parseContactCsv(`${HEADER}\nFoo Bar,,,,foo,`);
    expect(rows).toHaveLength(0);
    expect(rejected).toEqual([{ line: 1, reason: expect.stringContaining("Invalid lead status") }]);
  });

  it("accepts every canonical lead status", () => {
    const csv = `${HEADER}\n` +
      ["new", "contacted", "qualified", "unqualified", "disqualified", "customer"]
        .map((s, i) => `Person ${i},,,,${s},`)
        .join("\n");
    const { rows, rejected } = parseContactCsv(csv);
    expect(rejected).toHaveLength(0);
    expect(rows.map((r) => r.leadStatus)).toEqual([
      "new", "contacted", "qualified", "unqualified", "disqualified", "customer",
    ]);
  });

  it("rejects a row with a malformed email and keeps it out of the rows", () => {
    const { rows, rejected } = parseContactCsv(`${HEADER}\nAbc,abc,,,new,`);
    expect(rows).toHaveLength(0);
    expect(rejected).toEqual([{ line: 1, reason: expect.stringContaining("Invalid email") }]);
  });

  it("rejects a row with a malformed phone", () => {
    const { rows, rejected } = parseContactCsv(`${HEADER}\nAbc,,12345,,new,`);
    expect(rows).toHaveLength(0);
    expect(rejected).toEqual([{ line: 1, reason: expect.stringContaining("Invalid phone") }]);
  });

  it("rejects a row with no name", () => {
    const { rows, rejected } = parseContactCsv(`${HEADER}\n,a@b.com,9900000000,,new,`);
    expect(rows).toHaveLength(0);
    expect(rejected).toEqual([{ line: 1, reason: "Missing name." }]);
  });

  it("defaults marketingConsent to false when the column is absent/blank", () => {
    const { rows } = parseContactCsv(`${HEADER}\nAsha,asha@example.com,9900000000,Acme,new,`);
    expect(rows).toHaveLength(1);
    expect(rows[0].marketingConsent).toBe(false);
  });

  it("parses an explicit marketingConsent=true", () => {
    const { rows } = parseContactCsv(`${HEADER}\nAsha,asha@example.com,9900000000,Acme,new,yes`);
    expect(rows[0].marketingConsent).toBe(true);
  });

  it("defaults a blank lead status to new", () => {
    const { rows } = parseContactCsv(`${HEADER}\nAsha,,,,,`);
    expect(rows[0].leadStatus).toBe("new");
  });

  it("reports the correct line number for a mix of valid and invalid rows", () => {
    const csv = `${HEADER}\nGood One,,9900000000,,new,\nBad,abc,,,new,\nGood Two,,,,customer,`;
    const { rows, rejected } = parseContactCsv(csv);
    expect(rows.map((r) => r.name)).toEqual(["Good One", "Good Two"]);
    expect(rejected).toEqual([{ line: 2, reason: expect.stringContaining("Invalid email") }]);
  });
});

describe("parseContactCsv RFC-4180 (GAP-CRM-CONTACTS-IMPORT-03)", () => {
  it("keeps a quoted comma inside one field (company is not split)", () => {
    const csv = `${HEADER}\nAsha Rao,,,"Housing & Urban Development, Odisha",new,`;
    const { rows, rejected } = parseContactCsv(csv);
    expect(rejected).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].company).toBe("Housing & Urban Development, Odisha");
  });

  it("handles escaped quotes inside a quoted field", () => {
    const csv = `${HEADER}\nAsha,,,"ACME ""Pvt"" Ltd",new,`;
    const { rows } = parseContactCsv(csv);
    expect(rows[0].company).toBe('ACME "Pvt" Ltd');
  });

  it("keeps the first row when there is NO header (header-less file)", () => {
    // First row is real data, not a header — must not be dropped.
    const csv = `Asha Rao,,9900000000,Acme,new,\nBimal,,,Beta,customer,`;
    const { rows } = parseContactCsv(csv);
    expect(rows.map((r) => r.name)).toEqual(["Asha Rao", "Bimal"]);
  });

  it("strips the trailing \\r from CRLF input", () => {
    const csv = `${HEADER}\r\nAsha,,,Acme,new,\r\n`;
    const { rows, rejected } = parseContactCsv(csv);
    expect(rejected).toHaveLength(0);
    expect(rows[0].company).toBe("Acme");
    expect(rows[0].leadStatus).toBe("new"); // no trailing \r corrupting the status
  });

  it("rejects a row with more columns than expected (unquoted comma)", () => {
    // 7 unquoted fields > 6 columns.
    const csv = `${HEADER}\nAsha,,,Housing, Urban Dept,new,`;
    const { rejected } = parseContactCsv(csv);
    expect(rejected).toEqual([{ line: 1, reason: expect.stringContaining("Too many columns") }]);
  });
});

describe("field validators", () => {
  it("isValidMobile accepts a 10-digit 6-9 leading number and rejects others", () => {
    expect(isValidMobile("9900000000")).toBe(true);
    expect(isValidMobile("1234567890")).toBe(false);
    expect(isValidMobile("99000")).toBe(false);
  });
  it("isValidEmail", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
    expect(isValidEmail("abc")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
  });
  it("parseConsent", () => {
    expect(parseConsent("true")).toBe(true);
    expect(parseConsent("YES")).toBe(true);
    expect(parseConsent("1")).toBe(true);
    expect(parseConsent("")).toBe(false);
    expect(parseConsent(undefined)).toBe(false);
    expect(parseConsent("no")).toBe(false);
  });
});
