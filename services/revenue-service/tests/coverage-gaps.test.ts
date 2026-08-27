/**
 * Targeted tests to fill coverage gaps across all modules.
 *
 * Covers: repo layers (cache.getOrLoad paths), uncovered consumer branches,
 * uncovered route handlers (GET endpoints for rate-engine), BBPS enabled paths,
 * billing/billing error paths.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Common mock setup ─────────────────────────────────────────────────────────

const mockGetOrLoad = vi.fn();
const mockCacheInvalidate = vi.fn().mockResolvedValue(undefined);
const mockDbSelect = vi.fn();
const mockDbFrom = vi.fn();
const mockDbWhere = vi.fn();
const mockDbOrderBy = vi.fn();
const mockDbLimit = vi.fn();

const selectChain = {
  from: mockDbFrom,
};
mockDbSelect.mockReturnValue(selectChain);
mockDbFrom.mockReturnValue({ where: mockDbWhere, orderBy: mockDbOrderBy });
mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy, limit: mockDbLimit });
mockDbOrderBy.mockReturnValue({ limit: mockDbLimit });
mockDbLimit.mockResolvedValue([]);

vi.mock("../src/shared/db.js", () => ({
  db: {
    select: (...args: any[]) => mockDbSelect(...args),
    transaction: vi.fn(async (fn: any) => fn({
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "x" }]) }) }),
      select: (...a: any[]) => mockDbSelect(...a),
      update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "x" }]) }) }) }),
      // Revenue deep-verify pass: repo
      // functions now route reads through the real tenantTransaction() from
      // @civitasone/db, which calls setTenantGuc(runner, tenantId) — that
      // needs a runner.execute() method on the mocked tx, or it throws
      // "runner.execute is not a function" before ever reaching the mocked
      // select/insert/update chains above.
      execute: vi.fn().mockResolvedValue(undefined),
    })),
  },
  sqlClient: { end: vi.fn() },
  dbFor: vi.fn(),
  sqlClientFor: vi.fn(),
  tierOf: vi.fn(),
  dbForRead: vi.fn(),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: (...args: any[]) => mockGetOrLoad(...args),
    invalidate: (...args: any[]) => mockCacheInvalidate(...args),
    put: vi.fn(),
    get: vi.fn(),
  },
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn().mockResolvedValue(true),
  enqueue: vi.fn().mockResolvedValue(undefined),
  outboxSchema: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => args),
  and: vi.fn((...args: any[]) => args),
  desc: vi.fn((col: any) => col),
  sql: vi.fn().mockReturnValue({ mapWith: vi.fn().mockReturnValue("sql-expr") }),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Rate Engine Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Rate Engine Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([{ id: "rh-1", code: "PT" }]);
  });

  it("listRateHeads calls cache.getOrLoad and returns DB results", async () => {
    const { listRateHeads } = await import("../src/modules/rate-engine/repo.js");
    const result = await listRateHeads("11111111-1111-4111-8111-111111111111");
    expect(mockGetOrLoad).toHaveBeenCalledWith(
      "revenue:11111111-1111-4111-8111-111111111111:rate_heads",
      expect.any(Function),
    );
    expect(result).toEqual([{ id: "rh-1", code: "PT" }]);
  });

  it("listRateSlabs calls cache.getOrLoad with rateHeadId in key", async () => {
    const { listRateSlabs } = await import("../src/modules/rate-engine/repo.js");
    const result = await listRateSlabs("11111111-1111-4111-8111-111111111111", "rh-1");
    expect(mockGetOrLoad).toHaveBeenCalledWith(
      "revenue:11111111-1111-4111-8111-111111111111:rate_slabs:rh-1",
      expect.any(Function),
    );
    expect(result).toEqual([{ id: "rh-1", code: "PT" }]);
  });

  it("listPenaltyRules calls cache.getOrLoad with correct key", async () => {
    const { listPenaltyRules } = await import("../src/modules/rate-engine/repo.js");
    const result = await listPenaltyRules("11111111-1111-4111-8111-111111111111", "rh-1");
    expect(mockGetOrLoad).toHaveBeenCalledWith(
      "revenue:11111111-1111-4111-8111-111111111111:penalty_rules:rh-1",
      expect.any(Function),
    );
    expect(result).toEqual([{ id: "rh-1", code: "PT" }]);
  });

  it("listRebateRules calls cache.getOrLoad with correct key", async () => {
    const { listRebateRules } = await import("../src/modules/rate-engine/repo.js");
    const result = await listRebateRules("11111111-1111-4111-8111-111111111111", "rh-1");
    expect(mockGetOrLoad).toHaveBeenCalledWith(
      "revenue:11111111-1111-4111-8111-111111111111:rebate_rules:rh-1",
      expect.any(Function),
    );
    expect(result).toEqual([{ id: "rh-1", code: "PT" }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Assessee Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Assessee Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([{ id: "a-1", ownerName: "Test" }]);
  });

  it("findAssessee executes DB query via cache loader", async () => {
    const { findAssessee } = await import("../src/modules/assessee/repo.js");
    const result = await findAssessee("11111111-1111-4111-8111-111111111111", "a-1");
    expect(mockGetOrLoad).toHaveBeenCalledWith("revenue:11111111-1111-4111-8111-111111111111:assessee:a-1", expect.any(Function));
    expect(mockDbSelect).toHaveBeenCalled();
    expect(result).toEqual({ id: "a-1", ownerName: "Test" });
  });

  it("findAssessee returns null when DB returns empty", async () => {
    mockDbWhere.mockResolvedValue([]);
    const { findAssessee } = await import("../src/modules/assessee/repo.js");
    const result = await findAssessee("11111111-1111-4111-8111-111111111111", "nonexistent");
    expect(result).toBeNull();
  });

  it("listAssessees executes DB query via cache loader and paginates", async () => {
    mockDbWhere.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }, { id: "a-3" }]);
    const { listAssessees } = await import("../src/modules/assessee/repo.js");
    const result = await listAssessees("11111111-1111-4111-8111-111111111111", { limit: 2, offset: 0 });
    expect(result.data).toHaveLength(2);
    expect(result.meta.total).toBe(3);
  });

  it("listAssessees handles null from cache.getOrLoad", async () => {
    mockGetOrLoad.mockResolvedValue(null);
    const { listAssessees } = await import("../src/modules/assessee/repo.js");
    const result = await listAssessees("11111111-1111-4111-8111-111111111111", { limit: 10, offset: 0 });
    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Assessment Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Assessment Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([]);
  });

  it("findAssessment returns first row or null", async () => {
    mockDbWhere.mockResolvedValue([{ id: "as-1", status: "active" }]);
    const { findAssessment } = await import("../src/modules/assessment/repo.js");
    const result = await findAssessment("11111111-1111-4111-8111-111111111111", "as-1");
    expect(result).toEqual({ id: "as-1", status: "active" });
  });

  it("findAssessment returns null when empty", async () => {
    mockDbWhere.mockResolvedValue([]);
    const { findAssessment } = await import("../src/modules/assessment/repo.js");
    const result = await findAssessment("11111111-1111-4111-8111-111111111111", "xxx");
    expect(result).toBeNull();
  });

  it("listAssessments executes DB query via loader and paginates", async () => {
    mockDbWhere.mockResolvedValue([{ id: "a1" }, { id: "a2" }, { id: "a3" }]);
    const { listAssessments } = await import("../src/modules/assessment/repo.js");
    const result = await listAssessments("11111111-1111-4111-8111-111111111111", { limit: 2, offset: 0 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("listAssessments handles null from getOrLoad", async () => {
    mockGetOrLoad.mockResolvedValue(null);
    const { listAssessments } = await import("../src/modules/assessment/repo.js");
    const result = await listAssessments("11111111-1111-4111-8111-111111111111", { limit: 10, offset: 0 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("listDemands executes DB query via cache loader", async () => {
    mockDbWhere.mockResolvedValue([{ id: "d-1" }, { id: "d-2" }]);
    const { listDemands } = await import("../src/modules/assessment/repo.js");
    const result = await listDemands("11111111-1111-4111-8111-111111111111", "assessee-1");
    expect(mockGetOrLoad).toHaveBeenCalledWith(
      "revenue:11111111-1111-4111-8111-111111111111:demands:assessee-1",
      expect.any(Function),
    );
    expect(result).toEqual([{ id: "d-1" }, { id: "d-2" }]);
  });

  it("getDcbSummary computes demand/collection sums", async () => {
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbWhere.mockResolvedValue([
      { entryType: "demand", amountMinor: 100000n },
      { entryType: "collection", amountMinor: 30000n },
      { entryType: "demand", amountMinor: 50000n },
    ]);
    const { getDcbSummary } = await import("../src/modules/assessment/repo.js");
    const result = await getDcbSummary("11111111-1111-4111-8111-111111111111", "assessee-1");
    expect(result).toEqual({
      totalDemand: "150000",
      totalCollected: "30000",
      balance: "120000",
    });
  });

  it("getDemandBalance computes net balance from entries", async () => {
    mockDbWhere.mockResolvedValue([
      { entryType: "demand", amountMinor: 100000n },
      { entryType: "collection", amountMinor: 25000n },
    ]);
    const { getDemandBalance } = await import("../src/modules/assessment/repo.js");
    const result = await getDemandBalance("11111111-1111-4111-8111-111111111111", "demand-1");
    expect(result).toBe(75000n);
  });

  it("getDemandBalance returns 0n when no entries", async () => {
    mockDbWhere.mockResolvedValue([]);
    const { getDemandBalance } = await import("../src/modules/assessment/repo.js");
    const result = await getDemandBalance("11111111-1111-4111-8111-111111111111", "demand-1");
    expect(result).toBe(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Billing Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Billing Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockResolvedValue([]);
  });

  it("listBills executes DB query via cache loader and paginates", async () => {
    mockDbWhere.mockResolvedValue([{ id: "b-1" }, { id: "b-2" }, { id: "b-3" }]);
    const { listBills } = await import("../src/modules/billing/repo.js");
    const result = await listBills("11111111-1111-4111-8111-111111111111", "assessee-1", { limit: 2, offset: 0 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
  });

  it("listBills handles null from cache.getOrLoad", async () => {
    mockGetOrLoad.mockResolvedValue(null);
    const { listBills } = await import("../src/modules/billing/repo.js");
    const result = await listBills("11111111-1111-4111-8111-111111111111", "assessee-1", { limit: 10, offset: 0 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Collection Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Collection Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy, limit: mockDbLimit });
    mockDbOrderBy.mockReturnValue({ limit: mockDbLimit });
    mockDbLimit.mockResolvedValue([]);
  });

  it("listReceipts executes DB query via cache loader", async () => {
    mockDbOrderBy.mockResolvedValue([{ id: "r-1" }, { id: "r-2" }]);
    mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy, limit: mockDbLimit });
    const { listReceipts } = await import("../src/modules/collection/repo.js");
    const result = await listReceipts("11111111-1111-4111-8111-111111111111", "assessee-1", { limit: 10, offset: 0 });
    expect(result).toHaveLength(2);
  });

  it("listReceipts handles null from cache.getOrLoad", async () => {
    mockGetOrLoad.mockResolvedValue(null);
    const { listReceipts } = await import("../src/modules/collection/repo.js");
    const result = await listReceipts("11111111-1111-4111-8111-111111111111", "assessee-1", { limit: 10, offset: 0 });
    expect(result).toEqual([]);
  });

  it("findReceipt returns first matching row", async () => {
    mockDbLimit.mockResolvedValue([{ id: "r-1", amountMinor: 50000n }]);
    const { findReceipt } = await import("../src/modules/collection/repo.js");
    const result = await findReceipt("11111111-1111-4111-8111-111111111111", "r-1");
    expect(result).toEqual({ id: "r-1", amountMinor: 50000n });
  });

  it("findReceipt returns null when not found", async () => {
    mockDbLimit.mockResolvedValue([]);
    const { findReceipt } = await import("../src/modules/collection/repo.js");
    const result = await findReceipt("11111111-1111-4111-8111-111111111111", "nonexistent");
    expect(result).toBeNull();
  });

  it("getDemandBalance returns latest balance or 0n", async () => {
    mockDbLimit.mockResolvedValue([{ balanceMinor: 75000n }]);
    const { getDemandBalance } = await import("../src/modules/collection/repo.js");
    const result = await getDemandBalance("11111111-1111-4111-8111-111111111111", "demand-1");
    expect(result).toBe(75000n);
  });

  it("getDemandBalance returns 0n when no entries", async () => {
    mockDbLimit.mockResolvedValue([]);
    const { getDemandBalance } = await import("../src/modules/collection/repo.js");
    const result = await getDemandBalance("11111111-1111-4111-8111-111111111111", "demand-1");
    expect(result).toBe(0n);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Arrears Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Arrears Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrLoad.mockImplementation(async (_key: string, loader: () => Promise<any>) => loader());
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ orderBy: mockDbOrderBy });
    mockDbOrderBy.mockResolvedValue([{ id: "ip-1" }]);
  });

  it("listInstalmentPlans executes DB query via cache loader", async () => {
    const { listInstalmentPlans } = await import("../src/modules/arrears/repo.js");
    const result = await listInstalmentPlans("11111111-1111-4111-8111-111111111111", "assessee-1", { limit: 10, offset: 0 });
    expect(result).toHaveLength(1);
    expect(mockGetOrLoad).toHaveBeenCalledWith("revenue:11111111-1111-4111-8111-111111111111:instalments:assessee-1", expect.any(Function));
  });

  it("listInstalmentPlans handles null from cache.getOrLoad", async () => {
    mockGetOrLoad.mockResolvedValue(null);
    const { listInstalmentPlans } = await import("../src/modules/arrears/repo.js");
    const result = await listInstalmentPlans("11111111-1111-4111-8111-111111111111", "assessee-1", { limit: 10, offset: 0 });
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BBPS Repo Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("BBPS Repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbFrom.mockReturnValue({ where: mockDbWhere });
    mockDbWhere.mockReturnValue({ limit: mockDbLimit });
    mockDbLimit.mockResolvedValue([]);
  });

  it("getDcbOutstanding returns null when assessee not found", async () => {
    mockDbLimit.mockResolvedValue([]);
    const { getDcbOutstanding } = await import("../src/modules/bbps/repo.js");
    const result = await getDcbOutstanding("11111111-1111-4111-8111-111111111111", "UNKNOWN-ID");
    expect(result).toBeNull();
  });

  it("getDcbOutstanding returns outstanding data when assessee exists", async () => {
    // First call finds assessee, second call returns DCB aggregate
    mockDbLimit.mockResolvedValueOnce([{ id: "assessee-1", ownerName: "John Doe", identifierNo: "PROP-123" }]);
    // The second select doesn't use limit - it returns directly from where
    mockDbWhere
      .mockReturnValueOnce({ limit: mockDbLimit }) // first call to find assessee
      .mockResolvedValueOnce([{ totalOutstanding: 150000n, demandCount: 2, oldestDueDate: "2024-01-01" }]); // second call for DCB

    const { getDcbOutstanding } = await import("../src/modules/bbps/repo.js");
    const result = await getDcbOutstanding("11111111-1111-4111-8111-111111111111", "PROP-123");
    expect(result).not.toBeNull();
    expect(result!.assesseeId).toBe("assessee-1");
    expect(result!.ownerName).toBe("John Doe");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BBPS Schema (coverage trigger via import)
// ═══════════════════════════════════════════════════════════════════════════════

describe("BBPS Schema", () => {
  it("exports billerConfig and bbpsTransactions tables", async () => {
    const schema = await import("../src/modules/bbps/schema.js");
    expect(schema.billerConfig).toBeDefined();
    expect(schema.bbpsTransactions).toBeDefined();
    expect(schema.schema).toBeDefined();
  });
});
