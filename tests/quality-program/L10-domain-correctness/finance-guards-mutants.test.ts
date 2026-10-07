/**
 * L10 finance guards — mutation burn-down for gl/domain.ts and payments/domain.ts.
 *
 * Pins the behaviour of guards that previously had NO hermetic test in the
 * Stryker scope (their only tests import shared/db.ts and cannot run in the
 * mutation sandbox):
 *   gl:       assertJournalHasAmount (zero-amount 0/0 journal), assertNoControlAccounts
 *   payments: assertPayerNotPasser (SoD beyond maker != checker),
 *             maskPersonName, maskAdvanceBeneficiaries (PII masking by role)
 *
 * Expected values are written by hand from the documented rule, not derived by
 * calling the function under test.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");

type Line = { debitMinor: bigint | number; creditMinor: bigint | number };
type Adv = { type: string; beneficiary: string; purpose?: string };

let assertJournalHasAmount: (lines: Line[]) => void;
let assertNoControlAccounts: (refs: readonly string[]) => void;
let assertPayerNotPasser: (status: string, passer: string | null | undefined, payer: string) => void;
let maskPersonName: (name: string) => string;
let maskAdvanceBeneficiaries: <T extends Adv>(rows: T[], roles: readonly string[]) => T[];
let ADVANCE_OFFICER_NAME_ROLES: string[];

beforeAll(async () => {
  const gl = await import(`${REPO_ROOT}/services/finance-service/src/modules/gl/domain.js`);
  const pay = await import(`${REPO_ROOT}/services/finance-service/src/modules/payments/domain.js`);
  assertJournalHasAmount = gl.assertJournalHasAmount;
  assertNoControlAccounts = gl.assertNoControlAccounts;
  assertPayerNotPasser = pay.assertPayerNotPasser;
  maskPersonName = pay.maskPersonName;
  maskAdvanceBeneficiaries = pay.maskAdvanceBeneficiaries;
  ADVANCE_OFFICER_NAME_ROLES = pay.ADVANCE_OFFICER_NAME_ROLES;
});

describe("L10 gl — assertJournalHasAmount", () => {
  it("rejects a balanced 0/0 journal with JOURNAL_ZERO_AMOUNT", () => {
    expect(() => assertJournalHasAmount([
      { debitMinor: 0n, creditMinor: 0n },
      { debitMinor: 0n, creditMinor: 0n },
    ])).toThrow(/JOURNAL_ZERO_AMOUNT/);
  });
  it("rejects an empty line set (nothing to post)", () => {
    expect(() => assertJournalHasAmount([])).toThrow(/JOURNAL_ZERO_AMOUNT/);
  });
  it("accepts a journal whose debits total one paisa", () => {
    expect(() => assertJournalHasAmount([
      { debitMinor: 1n, creditMinor: 0n },
      { debitMinor: 0n, creditMinor: 1n },
    ])).not.toThrow();
  });
  it("sums debits across lines (a single non-zero debit among zeros is enough)", () => {
    expect(() => assertJournalHasAmount([
      { debitMinor: 0n, creditMinor: 0n },
      { debitMinor: 500n, creditMinor: 0n },
      { debitMinor: 0n, creditMinor: 500n },
    ])).not.toThrow();
  });
  it("accepts numeric (non-bigint) amounts, coerced via BigInt", () => {
    expect(() => assertJournalHasAmount([{ debitMinor: 100, creditMinor: 0 }, { debitMinor: 0, creditMinor: 100 }])).not.toThrow();
  });
  it("the error message names the reason", () => {
    expect(() => assertJournalHasAmount([])).toThrow(/zero net amount/);
  });
});

describe("L10 gl — assertNoControlAccounts", () => {
  it("passes when no control accounts are referenced", () => {
    expect(() => assertNoControlAccounts([])).not.toThrow();
  });
  it("rejects a single control account and names it", () => {
    expect(() => assertNoControlAccounts(["1100"])).toThrow(/CONTROL_ACCOUNT/);
    expect(() => assertNoControlAccounts(["1100"])).toThrow(/control account\(s\): 1100/);
  });
  it("lists every offending control account, comma-separated", () => {
    expect(() => assertNoControlAccounts(["1100", "2200"])).toThrow(/1100, 2200/);
  });
});

describe("L10 payments — assertPayerNotPasser (SoD: passer may not release payment)", () => {
  it("rejects when the passer is also the payer on a passed bill", () => {
    expect(() => assertPayerNotPasser("passed", "u-1", "u-1")).toThrow(/PAYER_IS_PASSER/);
  });
  it("allows a different payer", () => {
    expect(() => assertPayerNotPasser("passed", "u-1", "u-2")).not.toThrow();
  });
  it("only binds while the bill is in 'passed' status", () => {
    expect(() => assertPayerNotPasser("approved", "u-1", "u-1")).not.toThrow();
    expect(() => assertPayerNotPasser("paid", "u-1", "u-1")).not.toThrow();
  });
  it("does not fire when the passer is unknown (null / undefined / empty)", () => {
    expect(() => assertPayerNotPasser("passed", null, "u-1")).not.toThrow();
    expect(() => assertPayerNotPasser("passed", undefined, "u-1")).not.toThrow();
    expect(() => assertPayerNotPasser("passed", "", "u-1")).not.toThrow();
  });
  it("does not fire when the payer is blank", () => {
    expect(() => assertPayerNotPasser("passed", "u-1", "")).not.toThrow();
    expect(() => assertPayerNotPasser("passed", "", "")).not.toThrow();
  });
  it("the error message cites segregation of duties", () => {
    expect(() => assertPayerNotPasser("passed", "u-1", "u-1")).toThrow(/segregation of duties/);
  });
});

describe("L10 payments — maskPersonName", () => {
  it("masks each word to its first character plus ***", () => {
    expect(maskPersonName("Asha Verma")).toBe("A*** V***");
  });
  it("handles a single word", () => {
    expect(maskPersonName("Asha")).toBe("A***");
  });
  it("collapses runs of whitespace and trims", () => {
    expect(maskPersonName("  Asha   Kumar  Verma ")).toBe("A*** K*** V***");
  });
  it("blank input becomes ***", () => {
    expect(maskPersonName("")).toBe("***");
    expect(maskPersonName("   ")).toBe("***");
  });
  it("keeps a whole astral code point (not half a surrogate pair)", () => {
    expect(maskPersonName("\u{1D4D0}sha")).toBe("\u{1D4D0}***");
  });
  it("never leaks the rest of the name", () => {
    expect(maskPersonName("Asha Verma")).not.toMatch(/sha|erma/);
  });
});

describe("L10 payments — maskAdvanceBeneficiaries", () => {
  const rows: Adv[] = [
    { type: "employee", beneficiary: "Asha Verma", purpose: "Tour advance for Asha Verma" },
    { type: "employee", beneficiary: "Ravi Rao" },
    { type: "vendor", beneficiary: "Acme Supplies Pvt Ltd", purpose: "Mobilisation" },
  ];

  it("exposes the officer role list the policy documents", () => {
    expect([...ADVANCE_OFFICER_NAME_ROLES].sort()).toEqual(["audit_officer", "finance_admin", "finance_officer", "super_admin"]);
  });
  it("returns the rows untouched for each entitled role", () => {
    for (const role of ["finance_officer", "finance_admin", "super_admin", "audit_officer"]) {
      expect(maskAdvanceBeneficiaries(rows, [role])).toEqual(rows);
    }
  });
  it("an entitled role among several still unmasks", () => {
    expect(maskAdvanceBeneficiaries(rows, ["procurement_officer", "finance_officer"])).toEqual(rows);
  });
  it("masks employee beneficiaries and purpose for a non-entitled role", () => {
    const out = maskAdvanceBeneficiaries(rows, ["procurement_officer"]);
    expect(out[0]).toEqual({ type: "employee", beneficiary: "A*** V***", purpose: "***" });
    expect(out[1]).toEqual({ type: "employee", beneficiary: "R*** R***" });
  });
  it("does not add a purpose to a row that had none", () => {
    const out = maskAdvanceBeneficiaries(rows, ["procurement_officer"]);
    expect("purpose" in out[1]).toBe(false);
  });
  it("never masks vendor / organisation advances", () => {
    const out = maskAdvanceBeneficiaries(rows, ["procurement_officer"]);
    expect(out[2]).toEqual(rows[2]);
  });
  it("masks everything personal when the caller has no roles at all", () => {
    expect(maskAdvanceBeneficiaries(rows, [])[0].beneficiary).toBe("A*** V***");
  });
  it("does not mutate its input", () => {
    const copy = JSON.parse(JSON.stringify(rows));
    maskAdvanceBeneficiaries(rows, []);
    expect(rows).toEqual(copy);
  });
});
