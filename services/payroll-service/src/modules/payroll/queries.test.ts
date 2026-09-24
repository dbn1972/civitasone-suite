import { describe, it, expect, vi, beforeEach } from "vitest";

const listRunsByTenant = vi.fn();
const countSlipsByRunIds = vi.fn();
const findRunById = vi.fn();
const listSlipsByRun = vi.fn();
vi.mock("./repo.js", () => ({
  listRunsByTenant: (...args: unknown[]) => listRunsByTenant(...args),
  countSlipsByRunIds: (...args: unknown[]) => countSlipsByRunIds(...args),
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
    countSlipsByRunIds.mockReset();
    findRunById.mockReset();
    listSlipsByRun.mockReset();
    countSlipsByRunIds.mockResolvedValue(new Map());
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
