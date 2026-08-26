import { describe, it, expect, vi, beforeEach } from "vitest";

const findSlipById = vi.fn();
vi.mock("./repo.js", () => ({
  findSlipById: (...args: unknown[]) => findSlipById(...args),
}));

const fetchEmployeeSummaries = vi.fn();
vi.mock("../../shared/hrms-client.js", () => ({
  fetchEmployeeSummaries: (...args: unknown[]) => fetchEmployeeSummaries(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    // Bypass the real cache in unit tests -- just run the loader directly.
    getOrLoad: (_key: string, loader: () => unknown) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

import { getSlip } from "./queries.js";

describe("getSlip", () => {
  beforeEach(() => {
    findSlipById.mockReset();
    fetchEmployeeSummaries.mockReset();
  });

  it("returns null when the slip does not exist, without calling the employee lookup", async () => {
    findSlipById.mockResolvedValue(null);

    const result = await getSlip("missing-id", "tenant-1");

    expect(result).toBeNull();
    expect(fetchEmployeeSummaries).not.toHaveBeenCalled();
  });

  it("enriches the raw row with employee identity and both minor-unit naming conventions the two frontend detail pages expect", async () => {
    // Regression test: getSlip() used to return the bare DB row --
    // netPayMinor (no netMinor/net), grossMinor (no gross), no employeeName/
    // department at all. hr/payroll/salary-slips/[id]/page.tsx read
    // slip.netMinor (=> NaN) and hr/payroll/slips/[id]/page.tsx (via
    // getSlipById) read slip.net/slip.gross/slip.deductions (all undefined
    // => NaN), on the one screen whose entire purpose is confirming an
    // employee's take-home pay.
    findSlipById.mockResolvedValue({
      id: "slip-1",
      employeeId: "emp-42",
      employeeNo: "E-0042",
      basicMinor: 3000000n,
      grossMinor: 5000000n,
      totalDeductionsMinor: 700000n,
      netPayMinor: 4300000n,
      components: [{ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 3000000 }],
      status: "paid",
    });
    fetchEmployeeSummaries.mockResolvedValue(
      new Map([["emp-42", { fullName: "Anita Desai", departmentName: "Revenue" }]]),
    );

    const result = await getSlip("slip-1", "tenant-1");

    expect(result).not.toBeNull();
    expect(result?.employeeName).toBe("Anita Desai");
    expect(result?.department).toBe("Revenue");
    // *Minor-suffixed convention (hr/payroll/salary-slips/[id])
    expect(result?.netMinor).toBe(4300000);
    expect(result?.grossMinor).toBe(5000000);
    expect(result?.totalDeductionsMinor).toBe(700000);
    // Unsuffixed convention (hr/payroll/slips/[id] via SalarySlipSummary)
    expect(result?.net).toBe(4300000);
    expect(result?.gross).toBe(5000000);
    expect(result?.deductions).toBe(700000);
  });

  it("falls back to the employee number when hrms has no summary for this employee", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-2",
      employeeId: "emp-99",
      employeeNo: "E-0099",
      basicMinor: 1000000n,
      grossMinor: 1500000n,
      totalDeductionsMinor: 200000n,
      netPayMinor: 1300000n,
      components: [],
      status: "draft",
    });
    fetchEmployeeSummaries.mockResolvedValue(new Map());

    const result = await getSlip("slip-2", "tenant-1");

    expect(result?.employeeName).toBe("E-0099");
    expect(result?.department).toBe("—");
  });
});
