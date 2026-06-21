/**
 * BUG-3 regression: salary slip amounts were divided by 100 TWICE —
 * once in listSalarySlips (queries.ts) and again in the web fmtAmount formatter.
 * Fix: queries.ts returns minor units (paise); fmtAmount divides exactly once.
 */
import { vi, describe, it, expect } from "vitest";

const { mockSlipRow } = vi.hoisted(() => {
  const row = {
    id:                    "slip-001",
    tenantId:              "11111111-bbbb-4000-8000-000000000033",
    runId:                 "run-2024-01",
    employeeId:            "emp-001",
    employeeNo:            "EMP001",
    grossMinor:            BigInt(5_000_000),      // 50,000.00 INR
    totalDeductionsMinor:  BigInt(180_000),         //  1,800.00 INR
    netPayMinor:           BigInt(4_820_000),        // 48,200.00 INR
    status:                "paid",
    pfEmployeeMinor:       BigInt(180_000),
    pfEmployerMinor:       BigInt(180_000),
    tdsMinor:              BigInt(0),
    esiMinor:              BigInt(0),
    basicMinor:            BigInt(3_000_000),
    components:            [],
    currency:              "INR",
    createdAt:             new Date(),
    updatedAt:             new Date(),
    createdBy:             "actor-1",
    updatedBy:             "actor-1",
    version:               1,
  };
  return { mockSlipRow: row };
});

vi.mock("../src/modules/payroll/repo.js", () => ({
  listSlipsByTenant: vi.fn().mockResolvedValue([mockSlipRow]),
  findSlipById: vi.fn(),
  findRunById: vi.fn(),
  findRunByIdTx: vi.fn(),
  insertRun: vi.fn(),
  insertSlip: vi.fn(),
  insertStructure: vi.fn(),
  listRunsByTenant: vi.fn().mockResolvedValue([]),
  updateRun: vi.fn(),
}));

import { listSalarySlips } from "../src/modules/payroll/queries.js";

const TENANT = "11111111-bbbb-4000-8000-000000000033";

describe("BUG-3 — salary slip minor-unit convention (single /100 division)", () => {
  it("gross is returned as paise (5,000,000) — NOT pre-divided to rupees (50,000)", async () => {
    const slips = await listSalarySlips(TENANT, 10);
    expect(slips).toHaveLength(1);
    expect(slips[0]!.gross).toBe(5_000_000);
    expect(slips[0]!.gross).not.toBe(50_000); // the bug value
  });

  it("deductions is returned as paise (180,000)", async () => {
    const slips = await listSalarySlips(TENANT, 10);
    expect(slips[0]!.deductions).toBe(180_000);
    expect(slips[0]!.deductions).not.toBe(1_800); // the bug value
  });

  it("net is returned as paise (4,820,000)", async () => {
    const slips = await listSalarySlips(TENANT, 10);
    expect(slips[0]!.net).toBe(4_820_000);
    expect(slips[0]!.net).not.toBe(48_200); // the bug value
  });

  it("5,000,000 paise renders as ₹50,000.00 (single /100 in UI formatter)", () => {
    // Mirrors fmtAmount in apps/web/src/app/(app)/hr/payroll/salary-slips/page.tsx
    const fmtAmount = (minor: number) =>
      `₹${(minor / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    expect(fmtAmount(5_000_000)).toBe("₹50,000.00");
    // Bug scenario: when queries.ts also divided, gross arrived as 50,000 rupees
    // fmtAmount(50_000) → ₹500.00 — 100× too small
    expect(fmtAmount(50_000)).toBe("₹500.00");
  });
});
