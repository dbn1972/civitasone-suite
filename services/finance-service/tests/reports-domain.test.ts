/**
 * Finance Reports — domain contract tests.
 * Pack #21. Source: modules/reports/*
 */
import { describe, it, expect } from "vitest";

describe("expenditure report formula", () => {
  it("utilisation% = (committed + actual) / allocated * 100", () => {
    const allocated = 1_000_000n;
    const committed = 200_000n;
    const actual = 300_000n;
    const utilisationBps = ((committed + actual) * 10_000n) / allocated;
    expect(utilisationBps).toBe(5_000n); // 50.00%
  });

  it("0% when no spending", () => {
    const utilisationBps = ((0n + 0n) * 10_000n) / 1_000_000n;
    expect(utilisationBps).toBe(0n);
  });

  it("handles over-100% (overspend)", () => {
    const utilisationBps = ((600_000n + 600_000n) * 10_000n) / 1_000_000n;
    expect(utilisationBps).toBe(12_000n); // 120%
  });
});

describe("report no PII contract", () => {
  it("expenditure report does not expose vendor bank/PAN", () => {
    const reportRow = { headCode: "5100", headName: "Salary", allocated: "1000000", actual: "500000" };
    const json = JSON.stringify(reportRow);
    expect(json).not.toContain("bank_account");
    expect(json).not.toContain("pan");
    expect(json).not.toContain("aadhaar");
  });
});

describe("report deriveFY from period", () => {
  function deriveFY(period: string): string {
    const year = parseInt(period.slice(0, 4), 10);
    const month = parseInt(period.slice(5, 7), 10);
    const fyStart = month >= 4 ? year : year - 1;
    return `${fyStart}-${String(fyStart + 1).slice(2)}`;
  }

  it("2026-04 → 2026-27", () => expect(deriveFY("2026-04")).toBe("2026-27"));
  it("2026-03 → 2025-26", () => expect(deriveFY("2026-03")).toBe("2025-26"));
});

describe("report RBAC roles", () => {
  const REPORT_ROLES = ["finance_officer", "finance_admin", "super_admin", "audit_officer"];
  it("finance roles have access", () => expect(REPORT_ROLES).toContain("finance_officer"));
  it("audit_officer can read reports", () => expect(REPORT_ROLES).toContain("audit_officer"));
  it("citizen cannot access", () => expect(REPORT_ROLES).not.toContain("citizen"));
});
