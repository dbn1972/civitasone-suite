import { describe, it, expect, vi, beforeEach } from "vitest";

const findSlipById = vi.fn();
const findRunById = vi.fn();
vi.mock("./repo.js", () => ({
  findSlipById: (...args: unknown[]) => findSlipById(...args),
  findRunById: (...args: unknown[]) => findRunById(...args),
}));

const fetchEmployeeSummaries = vi.fn();
const fetchPayrollInput = vi.fn();
// vi.mock(...) factories are hoisted above ordinary top-level declarations
// (including `class`), so a plain `class MockHrmsUnavailableError` declared
// here would be in its temporal dead zone by the time the hoisted factory
// below runs. vi.fn()-initialized consts (findSlipById, fetchPayrollInput,
// etc.) get hoisted automatically; a class needs the explicit vi.hoisted()
// wrapper to get the same treatment.
const { MockHrmsUnavailableError } = vi.hoisted(() => {
  class MockHrmsUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "HrmsUnavailableError";
    }
  }
  return { MockHrmsUnavailableError };
});
vi.mock("../../shared/hrms-client.js", () => ({
  fetchEmployeeSummaries: (...args: unknown[]) => fetchEmployeeSummaries(...args),
  fetchPayrollInput: (...args: unknown[]) => fetchPayrollInput(...args),
  HrmsUnavailableError: MockHrmsUnavailableError,
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    // Bypass the real cache in unit tests -- just run the loader directly.
    getOrLoad: (_key: string, loader: () => unknown) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

import { getSlip } from "./queries.js";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1", tenantId: "tenant-1", month: "2026-08", status: "disbursed",
    disbursedAt: new Date("2026-09-01T10:00:00.000Z"),
    ...overrides,
  };
}

describe("getSlip", () => {
  beforeEach(() => {
    findSlipById.mockReset();
    findRunById.mockReset();
    fetchEmployeeSummaries.mockReset();
    fetchPayrollInput.mockReset();
    fetchPayrollInput.mockResolvedValue({ employees: [] });
  });

  it("returns null when the slip does not exist, without calling the employee lookup or the run lookup", async () => {
    findSlipById.mockResolvedValue(null);

    const result = await getSlip("missing-id", "tenant-1");

    expect(result).toBeNull();
    expect(fetchEmployeeSummaries).not.toHaveBeenCalled();
    expect(findRunById).not.toHaveBeenCalled();
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
      runId: "run-1",
      employeeId: "emp-42",
      employeeNo: "E-0042",
      basicMinor: 3000000n,
      grossMinor: 5000000n,
      totalDeductionsMinor: 700000n,
      netPayMinor: 4300000n,
      components: [{ code: "BASIC", name: "Basic Pay", type: "earning", amountMinor: 3000000 }],
      status: "paid",
      pfEmployeeMinor: 360000n, pfEmployerMinor: 360000n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 90000n,
    });
    findRunById.mockResolvedValue(makeRun());
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
      runId: "run-1",
      employeeId: "emp-99",
      employeeNo: "E-0099",
      basicMinor: 1000000n,
      grossMinor: 1500000n,
      totalDeductionsMinor: 200000n,
      netPayMinor: 1300000n,
      components: [],
      status: "draft",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun({ status: "draft", disbursedAt: null }));
    fetchEmployeeSummaries.mockResolvedValue(new Map());

    const result = await getSlip("slip-2", "tenant-1");

    expect(result?.employeeName).toBe("E-0099");
    expect(result?.department).toBe("—");
  });

  // GAP-PAYROLL-SALARY-SLIPS-DETAIL-06 / GAP-PAYROLL-SLIPS-DETAIL-04: the
  // single-slip endpoint never joined the run, so payPeriod/paidDate were
  // always absent on both detail pages even though the list endpoint (which
  // does join the run) always had them.
  it("fills payPeriod from the run's month and paidDate from disbursedAt", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-3", runId: "run-1", employeeId: "emp-1", employeeNo: "E-1",
      basicMinor: 1n, grossMinor: 1n, totalDeductionsMinor: 1n, netPayMinor: 1n,
      components: [], status: "finalized",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun());
    fetchEmployeeSummaries.mockResolvedValue(new Map());

    const result = await getSlip("slip-3", "tenant-1");

    expect(result?.payPeriod).toBe("2026-08");
    expect(result?.paidDate).toBe("2026-09-01T10:00:00.000Z");
  });

  it("paidDate is null for a run that has not been disbursed yet", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-4", runId: "run-1", employeeId: "emp-1", employeeNo: "E-1",
      basicMinor: 1n, grossMinor: 1n, totalDeductionsMinor: 1n, netPayMinor: 1n,
      components: [], status: "computed",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun({ status: "approved", disbursedAt: null }));
    fetchEmployeeSummaries.mockResolvedValue(new Map());

    const result = await getSlip("slip-4", "tenant-1");

    expect(result?.paidDate).toBeNull();
  });

  // GAP-PAYROLL-SALARY-SLIPS-DETAIL-05: the frontend used to hold its own
  // "XXXX-XXXX-" + last4 mask over a `slip.bankAccount` this endpoint never
  // actually populated (payroll_slips has no bank-account column -- the real
  // number lives only in HRMS). Resolving only the last 4 digits here means
  // the full number never reaches the web tier at all.
  it("resolves bankAccountLast4 from HRMS and never exposes the full number", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-5", runId: "run-1", employeeId: "emp-7", employeeNo: "E-7",
      basicMinor: 1n, grossMinor: 1n, totalDeductionsMinor: 1n, netPayMinor: 1n,
      components: [], status: "paid",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun());
    fetchEmployeeSummaries.mockResolvedValue(new Map());
    fetchPayrollInput.mockResolvedValue({ employees: [{ id: "emp-7", bankAccountNo: "123456789012" }] });

    const result = await getSlip("slip-5", "tenant-1");

    expect(result?.bankAccountLast4).toBe("9012");
    expect(Object.values(result ?? {})).not.toContain("123456789012");
  });

  it("degrades to bankAccountLast4: null (not a thrown error) when HRMS is unreachable", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-6", runId: "run-1", employeeId: "emp-7", employeeNo: "E-7",
      basicMinor: 1n, grossMinor: 1n, totalDeductionsMinor: 1n, netPayMinor: 1n,
      components: [], status: "paid",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun());
    fetchEmployeeSummaries.mockResolvedValue(new Map());
    fetchPayrollInput.mockRejectedValue(new MockHrmsUnavailableError("hrms payroll-input unreachable"));

    const result = await getSlip("slip-6", "tenant-1");

    expect(result?.bankAccountLast4).toBeNull();
    expect(result?.id).toBe("slip-6"); // the rest of the slip still renders
  });

  it("re-throws a non-HrmsUnavailableError from fetchPayrollInput instead of silently swallowing it", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-7", runId: "run-1", employeeId: "emp-7", employeeNo: "E-7",
      basicMinor: 1n, grossMinor: 1n, totalDeductionsMinor: 1n, netPayMinor: 1n,
      components: [], status: "paid",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun());
    fetchEmployeeSummaries.mockResolvedValue(new Map());
    fetchPayrollInput.mockRejectedValue(new Error("boom"));

    await expect(getSlip("slip-7", "tenant-1")).rejects.toThrow("boom");
  });

  // Pre-existing bug found alongside this enrichment: payroll_slips' seven
  // pf/gpf/nps/esi/tds columns are drizzle bigint-mode (real JS `bigint`s on
  // the raw row), and were never converted to `number` like basicMinor/
  // grossMinor/etc. Over HTTP the observability preSerialization hook turned
  // them into JSON strings (rejected by the web's z.number() schema); any
  // in-process JSON.stringify of a cold-cache result threw outright. See
  // getSlip.route.test.ts for the real-route/real-Postgres check.
  it("converts every statutory bigint column to a plain number so the whole result is JSON-safe", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-8", runId: "run-1", employeeId: "emp-7", employeeNo: "E-7",
      basicMinor: 500000n, grossMinor: 1000000n, totalDeductionsMinor: 200000n, netPayMinor: 800000n,
      components: [], status: "finalized",
      pfEmployeeMinor: 60000n, pfEmployerMinor: 60000n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 15000n,
    });
    findRunById.mockResolvedValue(makeRun());
    fetchEmployeeSummaries.mockResolvedValue(new Map());

    const result = await getSlip("slip-8", "tenant-1");

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result?.pfEmployeeMinor).toBe(60000);
    expect(result?.pfEmployerMinor).toBe(60000);
    expect(result?.tdsMinor).toBe(15000);
    expect(typeof result?.pfEmployeeMinor).toBe("number");
    expect(typeof result?.netPayMinor).toBe("number");
  });

  it("skips the HRMS bank-tail lookup entirely when the run has no month (defensive)", async () => {
    findSlipById.mockResolvedValue({
      id: "slip-9", runId: "run-1", employeeId: "emp-1", employeeNo: "E-1",
      basicMinor: 1n, grossMinor: 1n, totalDeductionsMinor: 1n, netPayMinor: 1n,
      components: [], status: "draft",
      pfEmployeeMinor: 0n, pfEmployerMinor: 0n, gpfMinor: 0n,
      npsEmployeeMinor: 0n, npsEmployerMinor: 0n, esiMinor: 0n, tdsMinor: 0n,
    });
    findRunById.mockResolvedValue(makeRun({ month: "" }));
    fetchEmployeeSummaries.mockResolvedValue(new Map());

    const result = await getSlip("slip-9", "tenant-1");

    expect(fetchPayrollInput).not.toHaveBeenCalled();
    expect(result?.bankAccountLast4).toBeNull();
  });
});
