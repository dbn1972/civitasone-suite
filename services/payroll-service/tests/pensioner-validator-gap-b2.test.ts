/**
 * GAP-PAYROLL-PENSIONERS-NEW-01/02/04 (b2-payroll-retirement batch):
 * server-side rules for POST /v1/payroll/pensioners (createPensionerBody).
 * The web form enforces the same rules, but the API must not rely on it.
 */
import { describe, it, expect } from "vitest";
import { createPensionerBody } from "../src/modules/payroll/validators.js";

const valid = { ppoNo: "PPO-001", fullName: "Test Pensioner", dateOfBirth: "1958-01-01", basicPensionMinor: "2500050" };
const future = (() => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() + 1); return d.toISOString().slice(0, 10); })();
const ok = (b: Record<string, unknown>) => createPensionerBody.safeParse(b).success;
const issuePaths = (b: Record<string, unknown>) => {
  const r = createPensionerBody.safeParse(b);
  return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
};

describe("createPensionerBody — basic pension (NEW-01)", () => {
  it("accepts a positive paise amount", () => expect(ok(valid)).toBe(true));
  it("rejects zero basic pension (blank web field used to arrive as 0)", () => expect(ok({ ...valid, basicPensionMinor: 0 })).toBe(false));
  it("rejects '0' basic pension", () => expect(ok({ ...valid, basicPensionMinor: "0" })).toBe(false));
  it("rejects a decimal string (was a raw BigInt SyntaxError -> 500) as a validation failure", () => {
    expect(() => createPensionerBody.safeParse({ ...valid, basicPensionMinor: "25000.50" })).not.toThrow();
    expect(ok({ ...valid, basicPensionMinor: "25000.50" })).toBe(false);
  });
  it("rejects a negative amount", () => expect(ok({ ...valid, basicPensionMinor: -5 })).toBe(false));
  it("transforms to bigint", () => {
    const r = createPensionerBody.parse(valid);
    expect(r.basicPensionMinor).toBe(2500050n);
  });
});

describe("createPensionerBody — dates (NEW-01, NEW-04)", () => {
  it("rejects a future date of birth", () => expect(issuePaths({ ...valid, dateOfBirth: future })).toContain("dateOfBirth"));
  it("rejects commuted amount without a commutation date", () =>
    expect(issuePaths({ ...valid, commutedPensionMinor: "500000" })).toContain("commutationDate"));
  it("rejects a commutation date without a commuted amount", () =>
    expect(issuePaths({ ...valid, commutationDate: "2018-06-30" })).toContain("commutedPensionMinor"));
  it("rejects a commutation date of 0 commuted amount", () =>
    expect(ok({ ...valid, commutedPensionMinor: "0", commutationDate: "2018-06-30" })).toBe(false));
  it("accepts both together", () => expect(ok({ ...valid, commutedPensionMinor: "500000", commutationDate: "2018-06-30" })).toBe(true));
  it("accepts neither (0 / undefined)", () => expect(ok({ ...valid, commutedPensionMinor: "0" })).toBe(true));
  it("rejects a commutation date before the date of birth", () =>
    expect(issuePaths({ ...valid, commutedPensionMinor: "500000", commutationDate: "1950-01-01" })).toContain("commutationDate"));
  it("rejects a future commutation date", () =>
    expect(issuePaths({ ...valid, commutedPensionMinor: "500000", commutationDate: future })).toContain("commutationDate"));
});

describe("createPensionerBody — bank / PAN formats (NEW-02)", () => {
  it("accepts a valid IFSC, account and PAN", () =>
    expect(ok({ ...valid, bankIfsc: "SBIN0001234", bankAccountNo: "123456789012", pan: "ABCDE1234F" })).toBe(true));
  it("rejects an IFSC whose 5th character is not 0", () => expect(ok({ ...valid, bankIfsc: "SBIN1001234" })).toBe(false));
  it("rejects a lowercase IFSC", () => expect(ok({ ...valid, bankIfsc: "sbin0001234" })).toBe(false));
  it("rejects an 8-digit account number", () => expect(ok({ ...valid, bankAccountNo: "12345678" })).toBe(false));
  it("rejects a non-digit account number", () => expect(ok({ ...valid, bankAccountNo: "12345ABC901" })).toBe(false));
  it("rejects a malformed PAN", () => expect(ok({ ...valid, pan: "ABCDE12345" })).toBe(false));
});
