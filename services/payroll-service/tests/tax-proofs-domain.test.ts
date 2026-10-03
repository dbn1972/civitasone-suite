/**
 * GAP-PAYROLL-TAX-DECLARATION-02: pure rules for investment-proof uploads.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  buildProofKey, contentTypeOfOwnKey, sanitizeFilename, retentionEndsOn, isPurgeDue, fyStartYear,
  PROOF_CONTENT_TYPES, VIEWER_ROLES, DECIDER_ROLES, RETENTION_ROLES, HOLD_ROLES,
} from "../src/modules/tax-proofs/domain.js";

const T = randomUUID();
const E = randomUUID();

describe("proof keys", () => {
  it("builds a tenant/FY/employee scoped key and recognises exactly its own keys", () => {
    const key = buildProofKey(T, "2025-26", E, randomUUID(), "application/pdf");
    expect(key.startsWith(`payroll/${T}/tax-proofs/2025-26/${E}/`)).toBe(true);
    expect(key.endsWith(".pdf")).toBe(true);
    expect(contentTypeOfOwnKey(key, T, "2025-26", E)).toBe("application/pdf");
    for (const ct of Object.keys(PROOF_CONTENT_TYPES) as Array<keyof typeof PROOF_CONTENT_TYPES>) {
      expect(contentTypeOfOwnKey(buildProofKey(T, "2025-26", E, randomUUID(), ct), T, "2025-26", E)).toBe(ct);
    }
  });

  it("rejects another tenant, employee or FY, traversal, and malformed tails", () => {
    const uuid = randomUUID();
    const own = buildProofKey(T, "2025-26", E, uuid, "image/png");
    expect(contentTypeOfOwnKey(own, randomUUID(), "2025-26", E)).toBeNull();
    expect(contentTypeOfOwnKey(own, T, "2025-26", randomUUID())).toBeNull();
    expect(contentTypeOfOwnKey(own, T, "2024-25", E)).toBeNull();
    expect(contentTypeOfOwnKey(`payroll/${T}/tax-proofs/2025-26/${E}/../${uuid}.png`, T, "2025-26", E)).toBeNull();
    expect(contentTypeOfOwnKey(`payroll/${T}/tax-proofs/2025-26/${E}/${uuid}.exe`, T, "2025-26", E)).toBeNull();
    expect(contentTypeOfOwnKey(`payroll/${T}/tax-proofs/2025-26/${E}/not-a-uuid.pdf`, T, "2025-26", E)).toBeNull();
    expect(contentTypeOfOwnKey(`payroll/${T}/tax-proofs/2025-26/${E}/${uuid}.pdf/extra`, T, "2025-26", E)).toBeNull();
    expect(contentTypeOfOwnKey(`other/${uuid}.pdf`, T, "2025-26", E)).toBeNull();
  });

  it("sanitises display filenames (paths and control chars stripped, bounded)", () => {
    expect(sanitizeFilename("C:\\docs\\rent receipt.pdf")).toBe("rent receipt.pdf");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("a\u0000b\u001f.pdf")).toBe("ab.pdf");
    expect(sanitizeFilename("   ")).toBe("proof");
    expect(sanitizeFilename("x".repeat(500))).toHaveLength(200);
  });
});

describe("retention", () => {
  it("counts from the END of the financial year (31 March) plus the tenant's years", () => {
    expect(fyStartYear("2025-26")).toBe(2025);
    expect(fyStartYear("2025-27")).toBeNull();
    expect(retentionEndsOn("2025-26", 8)?.toISOString().slice(0, 10)).toBe("2034-03-31");
    expect(retentionEndsOn("2025-26", 1)?.toISOString().slice(0, 10)).toBe("2027-03-31");
    expect(retentionEndsOn("garbage", 8)).toBeNull();
  });

  it("is purge-due only after the retention date, never under legal hold, and at once when withdrawn", () => {
    const base = { fy: "2020-21", years: 8, legalHold: false, status: "accepted" };
    expect(isPurgeDue(base, new Date("2029-03-31T12:00:00Z"))).toBe(false);
    expect(isPurgeDue(base, new Date("2029-04-01T00:00:00Z"))).toBe(true);
    expect(isPurgeDue({ ...base, legalHold: true }, new Date("2040-01-01T00:00:00Z"))).toBe(false);
    expect(isPurgeDue({ ...base, status: "removed" }, new Date("2021-01-01T00:00:00Z"))).toBe(true);
    expect(isPurgeDue({ ...base, status: "removed", legalHold: true }, new Date("2040-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("role sets", () => {
  it("excludes hr, manager, finance and employee from reading proofs of others; auditor is read-only", () => {
    for (const r of ["hr_admin", "hr_officer", "manager", "finance_officer", "finance_admin", "employee", "super_admin"]) {
      expect(VIEWER_ROLES as readonly string[]).not.toContain(r);
    }
    expect(VIEWER_ROLES as readonly string[]).toContain("auditor");
    expect(DECIDER_ROLES as readonly string[]).not.toContain("auditor");
    expect([...DECIDER_ROLES]).toEqual(["payroll_officer", "payroll_admin"]);
    expect([...HOLD_ROLES]).toEqual(["payroll_admin"]);
    expect([...RETENTION_ROLES]).toEqual(["payroll_admin", "tenant_admin", "super_admin"]);
  });
});
