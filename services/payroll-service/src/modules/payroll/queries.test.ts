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
  listRunSuspensionsByRun: async () => [],
}));

vi.mock("../../shared/infra.js", () => ({
  cache: {
    getOrLoad: (_key: string, loader: () => unknown) => loader(),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

const fetchPayrollReadiness = vi.fn(async () => new Map<string, string[]>());
vi.mock("../../shared/hrms-client.js", () => ({
  fetchEmployeeSummaries: async () => new Map(),
  fetchPayrollReadiness: (...args: unknown[]) => (fetchPayrollReadiness as (...a: unknown[]) => unknown)(...args),
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

// GAP-PAYROLL-DETAIL-05: per-slip pre-disbursement issue codes (no PAN / account number).
describe("getRunDetail attaches readiness issue codes to each slip", () => {
  const slip = (employeeId: string) => ({
    id: `slip-${employeeId}`, employeeId, employeeNo: `EMP-${employeeId}`,
    grossMinor: 100000n, totalDeductionsMinor: 10000n, netPayMinor: 90000n, status: "computed",
  });
  beforeEach(() => {
    findRunById.mockReset();
    listSlipsByRun.mockReset();
    fetchPayrollReadiness.mockReset();
    findRunById.mockResolvedValue({ ...baseRun, status: "processing", lastError: null });
    listSlipsByRun.mockResolvedValue([slip("e1"), slip("e2")]);
  });

  it("maps issue codes to the right employee and leaves healthy ones empty", async () => {
    fetchPayrollReadiness.mockResolvedValue(new Map([["e1", ["MISSING_PAN", "INVALID_IFSC"]]]));
    const detail = await getRunDetail("run-1", "tenant-1");
    const byEmp = Object.fromEntries((detail?.salarySlips ?? []).map((s) => [s.employeeId, s.issues]));
    expect(byEmp).toEqual({ e1: ["MISSING_PAN", "INVALID_IFSC"], e2: [] });
  });

  it("when hrms-service cannot answer (empty map) every slip simply has no issues, and the run still loads", async () => {
    fetchPayrollReadiness.mockResolvedValue(new Map());
    const detail = await getRunDetail("run-1", "tenant-1");
    expect(detail?.salarySlips.every((s) => s.issues.length === 0)).toBe(true);
  });

  it("never carries a PAN or account number on the slip", async () => {
    fetchPayrollReadiness.mockResolvedValue(new Map([["e1", ["MISSING_PAN"]]]));
    const detail = await getRunDetail("run-1", "tenant-1");
    expect(JSON.stringify(detail)).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
  });
});

// GAP-PAYROLL-RUNS-01: the runs payload carries exact integer-paise twins of every rupee float
// -- run-level (list + detail) AND per slip -- and a contract guard fails if any is not an integer.
describe("GAP-PAYROLL-RUNS-01 — exact integer-paise money on the runs payloads", () => {
  const INTEGER_STRING = /^-?\d+$/;

  beforeEach(() => {
    listRunsByTenant.mockReset();
    aggregateSlipsByRunIds.mockReset();
    findRunById.mockReset();
    listSlipsByRun.mockReset();
    fetchPayrollReadiness.mockReset();
    fetchPayrollReadiness.mockResolvedValue(new Map());
  });

  it("listRuns: grossMinor / netMinor / deductionsMinor are the exact aggregate paise as strings", async () => {
    listRunsByTenant.mockResolvedValue([{ ...baseRun, status: "approved", lastError: null }]);
    aggregateSlipsByRunIds.mockResolvedValue(new Map([
      ["run-1", { employeeCount: 3, grossMinor: 15_000_001n, netMinor: 12_345_678n }],
    ]));

    const [row] = await listRuns("tenant-1", 50);

    expect(row).toMatchObject({ grossMinor: "15000001", netMinor: "12345678", deductionsMinor: "2654323" });
    // the rupee floats stay (additive contract), derived from the same paise
    expect(row?.grossAmount).toBe(150000.01);
    expect(row?.netAmount).toBe(123456.78);
  });

  it("getRunDetail: run-level and per-slip paise strings are exact and sum consistently", async () => {
    findRunById.mockResolvedValue({ ...baseRun, status: "processing", lastError: null });
    listSlipsByRun.mockResolvedValue([
      { id: "s1", employeeId: "e1", employeeNo: "E1", grossMinor: 10_000_050n, totalDeductionsMinor: 1_000_025n, netPayMinor: 9_000_025n, status: "computed" },
      { id: "s2", employeeId: "e2", employeeNo: "E2", grossMinor: 5_000_001n, totalDeductionsMinor: 654_298n, netPayMinor: 4_345_703n, status: "computed" },
    ]);

    const detail = await getRunDetail("run-1", "tenant-1");

    expect(detail).toMatchObject({ grossMinor: "15000051", netMinor: "13345728", deductionsMinor: "1654323" });
    expect(detail?.salarySlips.map((s) => [s.grossMinor, s.deductionsMinor, s.netMinor])).toEqual([
      ["10000050", "1000025", "9000025"],
      ["5000001", "654298", "4345703"],
    ]);
    // run total == sum of slip strings, exactly (BigInt)
    const sum = (k: "grossMinor" | "deductionsMinor" | "netMinor") =>
      detail!.salarySlips.reduce((a, s) => a + BigInt(s[k]), 0n);
    expect(sum("grossMinor")).toBe(BigInt(detail!.grossMinor));
    expect(sum("netMinor")).toBe(BigInt(detail!.netMinor));
  });

  it("CONTRACT: no money *Minor field on the list or detail payload is ever non-integer", async () => {
    listRunsByTenant.mockResolvedValue([{ ...baseRun, status: "approved", lastError: null }]);
    aggregateSlipsByRunIds.mockResolvedValue(new Map([["run-1", { employeeCount: 1, grossMinor: 9_007_199_254_740_993n, netMinor: 1n }]]));
    findRunById.mockResolvedValue({ ...baseRun, status: "approved", lastError: null });
    listSlipsByRun.mockResolvedValue([
      { id: "s1", employeeId: "e1", employeeNo: "E1", grossMinor: 9_007_199_254_740_993n, totalDeductionsMinor: 0n, netPayMinor: 9_007_199_254_740_993n, status: "computed" },
    ]);

    const [row] = await listRuns("tenant-1", 50);
    const detail = await getRunDetail("run-1", "tenant-1");

    for (const v of [row?.grossMinor, row?.netMinor, row?.deductionsMinor, detail?.grossMinor, detail?.netMinor, detail?.deductionsMinor]) {
      expect(v).toMatch(INTEGER_STRING);
    }
    for (const slip of detail?.salarySlips ?? []) {
      for (const v of [slip.grossMinor, slip.deductionsMinor, slip.netMinor]) expect(v).toMatch(INTEGER_STRING);
    }
    // bigint-safe: the digits beyond 2^53 survive (a float would have rounded to ...992)
    expect(row?.grossMinor).toBe("9007199254740993");
    expect(detail?.salarySlips[0]?.grossMinor).toBe("9007199254740993");
  });
});

