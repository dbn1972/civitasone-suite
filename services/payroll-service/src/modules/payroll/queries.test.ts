import { describe, it, expect, vi, beforeEach } from "vitest";

const listRunsByTenant = vi.fn();
const aggregateSlipsByRunIds = vi.fn();
const findRunById = vi.fn();
const listSlipsByRun = vi.fn();
vi.mock("./repo.js", () => ({
  listRunsByTenant: (...args: unknown[]) => listRunsByTenant(...args),
  aggregateSlipsByRunIds: (...args: unknown[]) => aggregateSlipsByRunIds(...args),
  findRunById: (...args: unknown[]) => findRunById(...args),
  listSlipsByRun: (...args: unknown[]) => listSlipsByRun(...args),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    getOrLoad: (_key: string, loader: () => unknown) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

vi.mock("../../shared/hrms-client.js", () => ({
  fetchEmployeeSummaries: async () => new Map(),
}));

import { listRuns, getRunDetail } from "./queries.js";

const baseRun = {
  id: "run-1",
  tenantId: "tenant-1",
  runNo: "RUN-1",
  month: "2026-06",
  createdAt: "2026-06-01T00:00:00.000Z",
  totalGrossMinor: 0n,
  totalNetMinor: 0n,
};

describe("payroll-critical fix — mapRunStatus / failureReason", () => {
  beforeEach(() => {
    listRunsByTenant.mockReset();
    aggregateSlipsByRunIds.mockReset();
    findRunById.mockReset();
    listSlipsByRun.mockReset();
    aggregateSlipsByRunIds.mockResolvedValue(new Map());
    listSlipsByRun.mockResolvedValue([]);
  });

  describe("listRuns", () => {
    it("REGRESSION: a run whose async processing genuinely failed is reported as status 'failed', not silently remapped to 'draft'", async () => {
      // Before this fix, queries.ts's mapRunStatus() had an explicit
      // `if (status === "failed") return "draft";` -- a run whose processing
      // threw (e.g. HrmsUnavailableError from the internal-secret bug) was
      // indistinguishable from a freshly-created, healthy draft anywhere the
      // frontend read this field (runs-list, run-detail).
      listRunsByTenant.mockResolvedValue([{ ...baseRun, status: "failed", lastError: "hrms payroll-input failed: 401" }]);

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.status).toBe("failed");
      expect(row?.status).not.toBe("draft");
    });

    it("surfaces the recorded failure reason as failureReason for a failed run", async () => {
      listRunsByTenant.mockResolvedValue([{ ...baseRun, status: "failed", lastError: "hrms payroll-input failed: 401" }]);

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.failureReason).toBe("hrms payroll-input failed: 401");
    });

    it("failureReason is null when no reason was recorded (a failed run predating migration 0046, or the column genuinely unset)", async () => {
      listRunsByTenant.mockResolvedValue([{ ...baseRun, status: "failed", lastError: null }]);

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.status).toBe("failed");
      expect(row?.failureReason).toBeNull();
    });

    it("failureReason is null for a healthy (non-failed) run, even if last_error happens to be set from a prior failure", async () => {
      // A run that failed, was retried/reprocessed, and now sits at a
      // healthy status should not keep showing a stale failure reason.
      listRunsByTenant.mockResolvedValue([{ ...baseRun, status: "processing", lastError: "stale reason from an earlier attempt" }]);

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.status).toBe("processing");
      expect(row?.failureReason).toBeNull();
    });

    it.each([
      ["disbursed", "paid"],
      ["approved", "completed"],
      ["processing", "processing"],
      ["draft", "draft"],
    ])("maps the healthy backend status '%s' to the existing frontend value '%s' (non-regression)", async (backendStatus, expected) => {
      listRunsByTenant.mockResolvedValue([{ ...baseRun, status: backendStatus, lastError: null }]);

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.status).toBe(expected);
    });
  });

  describe("getRunDetail", () => {
    it("REGRESSION: reports status 'failed' with its failureReason for a single run's detail view, matching the runs-list fix", async () => {
      findRunById.mockResolvedValue({ ...baseRun, status: "failed", lastError: "hrms payroll-input failed: 401" });

      const detail = await getRunDetail("run-1", "tenant-1");

      expect(detail?.status).toBe("failed");
      expect(detail?.failureReason).toBe("hrms payroll-input failed: 401");
    });

    it("returns null failureReason for a healthy run", async () => {
      findRunById.mockResolvedValue({ ...baseRun, status: "processing", lastError: null });

      const detail = await getRunDetail("run-1", "tenant-1");

      expect(detail?.status).toBe("processing");
      expect(detail?.failureReason).toBeNull();
    });
  });
});

describe("runs-list totals-vs-headcount fix — gross/net always match the live payslip aggregate", () => {
  beforeEach(() => {
    listRunsByTenant.mockReset();
    aggregateSlipsByRunIds.mockReset();
    findRunById.mockReset();
    listSlipsByRun.mockReset();
  });

  describe("listRuns", () => {
    it("REGRESSION: a run with zero payslips shows Rs 0 gross/net, even though the stored run row carries a stale non-zero total", async () => {
      // The stored total_gross_minor/total_net_minor on the run row itself
      // are deliberately non-zero here -- exactly the reported bug's data
      // shape (a run whose slips were since reduced to zero without its
      // stored totals being revalidated). aggregateSlipsByRunIds resolving
      // an empty Map (this run id absent) is the live, authoritative signal
      // that there are in fact zero payslips for it.
      listRunsByTenant.mockResolvedValue([{ ...baseRun, totalGrossMinor: 5_000_000n, totalNetMinor: 4_500_000n, status: "approved", lastError: null }]);
      aggregateSlipsByRunIds.mockResolvedValue(new Map());

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.employeeCount).toBe(0);
      expect(row?.grossAmount).toBe(0);
      expect(row?.netAmount).toBe(0);
      expect(row?.deductions).toBe(0);
    });

    it("a run's displayed gross/net/deductions come from the live per-run slip aggregate, not the stored run row, even when they disagree", async () => {
      listRunsByTenant.mockResolvedValue([{ ...baseRun, totalGrossMinor: 999_999n, totalNetMinor: 999_999n, status: "approved", lastError: null }]);
      aggregateSlipsByRunIds.mockResolvedValue(new Map([
        ["run-1", { employeeCount: 3, grossMinor: 300_000n, netMinor: 270_000n }],
      ]));

      const [row] = await listRuns("tenant-1", 50);

      expect(row?.employeeCount).toBe(3);
      expect(row?.grossAmount).toBe(3000); // 300000 minor / 100
      expect(row?.netAmount).toBe(2700); // 270000 minor / 100
      expect(row?.deductions).toBe(300); // (300000-270000)/100
    });
  });

  describe("getRunDetail", () => {
    it("REGRESSION: a run with zero payslips shows Rs 0 gross/net in the detail view too, even with a stale non-zero stored total", async () => {
      findRunById.mockResolvedValue({ ...baseRun, totalGrossMinor: 5_000_000n, totalNetMinor: 4_500_000n, status: "approved", lastError: null });
      listSlipsByRun.mockResolvedValue([]);

      const detail = await getRunDetail("run-1", "tenant-1");

      expect(detail?.employeeCount).toBe(0);
      expect(detail?.grossAmount).toBe(0);
      expect(detail?.netAmount).toBe(0);
      expect(detail?.deductions).toBe(0);
    });

    it("sums the actual slip rows for gross/net, not the stored run row, even when they disagree", async () => {
      findRunById.mockResolvedValue({ ...baseRun, totalGrossMinor: 999_999n, totalNetMinor: 999_999n, status: "approved", lastError: null });
      listSlipsByRun.mockResolvedValue([
        { id: "slip-1", employeeId: "emp-1", employeeNo: "E1", grossMinor: 200_000n, netPayMinor: 180_000n, totalDeductionsMinor: 20_000n, status: "computed" },
        { id: "slip-2", employeeId: "emp-2", employeeNo: "E2", grossMinor: 100_000n, netPayMinor: 90_000n, totalDeductionsMinor: 10_000n, status: "computed" },
      ]);

      const detail = await getRunDetail("run-1", "tenant-1");

      expect(detail?.employeeCount).toBe(2);
      expect(detail?.grossAmount).toBe(3000); // (200000+100000)/100
      expect(detail?.netAmount).toBe(2700); // (180000+90000)/100
      expect(detail?.deductions).toBe(300);
    });
  });
});
