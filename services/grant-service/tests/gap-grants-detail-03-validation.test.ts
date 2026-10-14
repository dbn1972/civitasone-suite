/** GAP-GRANTS-DETAIL-03: the disburse body keeps the audit reason and the payee bank ref apart, and validates both. */
import { describe, it, expect } from "vitest";
import { disburseBody } from "../src/modules/disbursement/validators.js";

describe("disburseBody (GAP-GRANTS-DETAIL-03)", () => {
  it("accepts a reason alone (bank ref resolved server-side)", () => {
    const r = disburseBody.parse({ mode: "PFMS", reason: "Sanction 12/2026" });
    expect(r.reason).toBe("Sanction 12/2026");
    expect(r.beneficiaryBankRef).toBeUndefined();
  });
  it("rejects a free-text reason posted as beneficiaryBankRef", () => {
    expect(disburseBody.safeParse({ mode: "PFMS", beneficiaryBankRef: "Sanction 12/2026" }).success).toBe(false);
  });
  it("accepts a prefixed or bare bank-account uuid", () => {
    const id = "3f000000-cccc-4000-8000-0000000000a1";
    expect(disburseBody.safeParse({ beneficiaryBankRef: `grant_bank_accounts:${id}` }).success).toBe(true);
    expect(disburseBody.safeParse({ beneficiaryBankRef: id }).success).toBe(true);
  });
  it("rejects a too-short or too-long reason", () => {
    expect(disburseBody.safeParse({ reason: "ab" }).success).toBe(false);
    expect(disburseBody.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });
});
