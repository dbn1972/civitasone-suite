/**
 * bank-transfer route tests — POST /v1/payroll/runs/:id/bank-file
 * (GAP-PAYROLL-DISBURSEMENT-02: was a reason-less GET; GET now answers 410)
 *
 * Covers: 200 (CSV happy path), 200 (NACH format), 409 (invalid state),
 * 401 (no token), 403 (wrong role), 404 (run not found / no slips),
 * 422 (missing bank details / sponsor config / APBS not enabled).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000077";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-000000000077";
const RUN_ID = "cccccccc-dddd-4000-8000-000000000077";
const REASON = "September salary NEFT batch for SBI";

function adminToken(roles = ["payroll_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET);
}

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockScopedRead = vi.fn();
const mockDbTransaction = vi.fn();

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (...args: unknown[]) => mockDbTransaction(...args) },
  scopedRead: (...args: unknown[]) => mockScopedRead(...args),
  sqlClient: { end: vi.fn() },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()), makeKey: vi.fn((...a: string[]) => a.join(":")), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(),
  markProcessed: vi.fn(() => true),
  outboxMessages: {},
  processed: {},
  outboxSchema: {},
}));

vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(),
  fetchPendingPayrollRuns: vi.fn(() => 0),
}));

vi.mock("../src/modules/sponsor-config/repo.js", () => ({
  findByTenantId: vi.fn(),
}));

vi.mock("../src/modules/bank-transfer/format-router.js", () => ({
  generateBankFile: vi.fn(),
}));

vi.mock("../src/modules/bank-transfer/zip-util.js", () => ({
  createZipBuffer: vi.fn(() => Buffer.from("PK-FAKE-ZIP")),
}));

// GAP-PAYROLL-DISBURSEMENT-TRANSFERS: which lines a file carries and the
// ledger/issuance/audit writes are SQL under an advisory lock
// (bank-transfer/issuance.ts), covered end to end against real Postgres in
// disbursement-transfers-real-db.test.ts. Here the issuance plans a FIRST
// file (every payable slip) and calls the route's real renderer, so file
// content, 422s and headers are still exercised.
vi.mock("../src/modules/bank-transfer/issuance.js", async (importOriginal) => ({
  // keep the real PAYABLE_SLIP_STATUSES allow-list
  ...(await importOriginal<typeof import("../src/modules/bank-transfer/issuance.js")>()),
  issueBankFile: vi.fn(async (input: {
    payableSlips: Array<{ id: string; employeeId: string; employeeNo: string; netPayMinor: bigint }>;
    master: Map<string, { fullName: string; bankAccountNo: string | null; bankIfsc: string | null }>;
    render: (lines: unknown[], at: { seq: number; batchBase: number }) => unknown;
  }) => {
    const lines = input.payableSlips.map((s) => {
      const b = input.master.get(s.employeeId);
      return {
        kind: "first", slipId: s.id, employeeId: s.employeeId, employeeNo: s.employeeNo,
        name: b?.fullName ?? s.employeeNo, amountMinor: s.netPayMinor,
        ifsc: (b?.bankIfsc ?? "").trim().toUpperCase(), accountNo: (b?.bankAccountNo ?? "").trim(),
      };
    });
    const file = input.render(lines, { seq: 1, batchBase: 1 });
    return { file, issuanceId: "iss-1", mode: "first", lineCount: lines.length, totalMinor: 0n };
  }),
}));

vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID, tenantId: TENANT, runNo: "RUN/2025/001", month: "2025-06",
    status: "approved", runType: "salary", currency: "INR",
    totalGrossMinor: 10000n, totalNetMinor: 8000n,
    ...overrides,
  };
}

function makeSlip(overrides: Record<string, unknown> = {}) {
  return {
    id: "slip-001", tenantId: TENANT, runId: RUN_ID, employeeId: "emp-001",
    employeeNo: "EMP001", basicMinor: 5000n, grossMinor: 10000n,
    totalDeductionsMinor: 2000n, netPayMinor: 8000n, currency: "INR",
    components: [], status: "computed", ...overrides,
  };
}

describe("POST /v1/payroll/runs/:id/bank-file", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps queued mockResolvedValueOnce values; a test that
    // returns before consuming its queued run/slips (e.g. a 400) would leak
    // them into the next test.
    mockScopedRead.mockReset();
    mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  });

  afterAll(async () => {
    const { sqlClient } = await import("../src/shared/db.js");
    await sqlClient.end();
  });

  // ═══ 401 — no token ═══════════════════════════════════════════════════════
  it("returns 401 when no auth token provided", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  // ═══ 403 — wrong role ═════════════════════════════════════════════════════
  it("returns 403 for unauthorized role", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
      headers: { authorization: `Bearer ${adminToken(["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  // ═══ 404 — run not found ══════════════════════════════════════════════════
  it("returns 404 when run does not exist", async () => {
    mockScopedRead.mockResolvedValueOnce([]); // no run found
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  // ═══ 400 — invalid state (draft) ═════════════════════════════════════════
  it("returns 409 when run is in draft state (unapproved)", async () => {
    mockScopedRead.mockResolvedValueOnce([makeRun({ status: "draft" })]);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // ═══ 400 — invalid state (processing) ════════════════════════════════════
  it("returns 409 when run is in processing state (unapproved)", async () => {
    mockScopedRead.mockResolvedValueOnce([makeRun({ status: "processing" })]);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // ═══ 404 — no slips found (CSV) ══════════════════════════════════════════
  it("returns 404 when no slips exist for the run (CSV)", async () => {
    mockScopedRead
      .mockResolvedValueOnce([makeRun()])  // run found
      .mockResolvedValueOnce([]);          // no slips
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  // ═══ 422 — missing bank details (CSV) ════════════════════════════════════
  it("returns 422 when employee bank details are missing (CSV)", async () => {
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2025-06",
      employees: [{ id: "emp-001", employeeNo: "EMP001", fullName: "John",
        basicMinor: "5000", payStructureId: null, bankAccountNo: null,
        bankIfsc: null, pan: null, uan: null, cityClass: "X" as const,
        taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const }],
      lopDays: {},
    });
    mockScopedRead
      .mockResolvedValueOnce([makeRun()])       // run found
      .mockResolvedValueOnce([makeSlip()]);     // slips found
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("BANK_DETAILS_MISSING");
  });

  // ═══ 200 — CSV happy path ════════════════════════════════════════════════
  it("returns 200 with CSV content when bank details are valid", async () => {
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2025-06",
      employees: [{ id: "emp-001", employeeNo: "EMP001", fullName: "John Doe",
        basicMinor: "5000", payStructureId: null,
        bankAccountNo: "1234567890", bankIfsc: "SBIN0001234",
        pan: null, uan: null, cityClass: "X" as const,
        taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const }],
      lopDays: {},
    });
    mockScopedRead
      .mockResolvedValueOnce([makeRun()])       // run found
      .mockResolvedValueOnce([makeSlip()]);     // slips found
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("bank_transfer_");
    expect(res.body).toContain("Employee No,Name,Bank Account,IFSC,Net Pay Amount,Narration");
    expect(res.body).toContain("TRAILER");
  });

  // ═══ 422 — NACH format missing sponsor config ═══════════════════════════
  it("returns 422 when sponsor config is missing for NACH format", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    vi.mocked(findByTenantId).mockResolvedValue(null);
    mockScopedRead.mockResolvedValueOnce([makeRun()]); // run found
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "nach", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("SPONSOR_CONFIG_MISSING");
  });

  // ═══ 422 — APBS not enabled ══════════════════════════════════════════════
  it("returns 422 when APBS is not enabled for the tenant", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    vi.mocked(findByTenantId).mockResolvedValue({
      id: "cfg-1", tenantId: TENANT, sponsorCode: "SPONS01",
      sponsorIfsc: "SBIN0000001", sponsorAccount: "9999999999",
      utilityCode: "UTIL01", userNumber: "USR001",
      settlementOffsetDays: 1, nachEnabled: true, apbsEnabled: false,
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);
    mockScopedRead.mockResolvedValueOnce([makeRun()]); // run found
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "apbs", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("APBS_NOT_ENABLED");
  });

  // ═══ 422 — APBS requested, but no Aadhaar/IIN data exists anywhere ══════
  it("returns 422 APBS_DATA_UNAVAILABLE (not 500) when APBS is enabled, before ever building beneficiaries", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    const { generateBankFile } = await import("../src/modules/bank-transfer/format-router.js");
    vi.mocked(findByTenantId).mockResolvedValue({
      id: "cfg-1", tenantId: TENANT, sponsorCode: "SPONS01",
      sponsorIfsc: "SBIN0000001", sponsorAccount: "9999999999",
      utilityCode: "UTIL01", userNumber: "USR001",
      settlementOffsetDays: 1, nachEnabled: true, apbsEnabled: true,
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);
    mockScopedRead.mockResolvedValueOnce([makeRun()]); // run found
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "apbs", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("APBS_DATA_UNAVAILABLE");
    // The fix must short-circuit BEFORE ever fetching slips/employees or
    // calling the writer -- confirms this isn't just a downstream validation
    // catch, but a genuine upfront guard.
    expect(fetchPayrollInput).not.toHaveBeenCalled();
    expect(vi.mocked(generateBankFile)).not.toHaveBeenCalled();
  });

  // ═══ 404 — no slips found (NACH) ═════════════════════════════════════════
  it("returns 404 when no slips exist for the run (NACH format)", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    vi.mocked(findByTenantId).mockResolvedValue({
      id: "cfg-1", tenantId: TENANT, sponsorCode: "SPONS01",
      sponsorIfsc: "SBIN0000001", sponsorAccount: "9999999999",
      utilityCode: "UTIL01", userNumber: "USR001",
      settlementOffsetDays: 1, nachEnabled: true, apbsEnabled: true,
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);
    mockScopedRead
      .mockResolvedValueOnce([makeRun()])  // run found
      .mockResolvedValueOnce([]);          // no slips
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "nach", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  // ═══ 200 — NACH happy path (single file) ═════════════════════════════════
  it("returns 200 with NACH file content (single file result)", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    const { generateBankFile } = await import("../src/modules/bank-transfer/format-router.js");

    vi.mocked(findByTenantId).mockResolvedValue({
      id: "cfg-1", tenantId: TENANT, sponsorCode: "SPONS01",
      sponsorIfsc: "SBIN0000001", sponsorAccount: "9999999999",
      utilityCode: "UTIL01", userNumber: "USR001",
      settlementOffsetDays: 1, nachEnabled: true, apbsEnabled: true,
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);

    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2025-06",
      employees: [{ id: "emp-001", employeeNo: "EMP001", fullName: "John Doe",
        basicMinor: "5000", payStructureId: null,
        bankAccountNo: "1234567890", bankIfsc: "SBIN0001234",
        pan: null, uan: null, cityClass: "X" as const,
        taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const }],
      lopDays: {},
    });

    vi.mocked(generateBankFile).mockReturnValue({
      type: "single",
      filename: "NACH_BATCH_001.txt",
      contentType: "text/plain",
      content: "NACH FILE CONTENT",
    } as never);

    mockScopedRead
      .mockResolvedValueOnce([makeRun()])       // run found
      .mockResolvedValueOnce([makeSlip()]);     // slips found

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "nach", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.headers["content-disposition"]).toContain("NACH_BATCH_001.txt");
    expect(res.body).toBe("NACH FILE CONTENT");
  });

  // ═══ 200 — NACH multi-file → ZIP ═════════════════════════════════════════
  it("returns 200 with ZIP when NACH generates multiple files", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    const { generateBankFile } = await import("../src/modules/bank-transfer/format-router.js");

    vi.mocked(findByTenantId).mockResolvedValue({
      id: "cfg-1", tenantId: TENANT, sponsorCode: "SPONS01",
      sponsorIfsc: "SBIN0000001", sponsorAccount: "9999999999",
      utilityCode: "UTIL01", userNumber: "USR001",
      settlementOffsetDays: 1, nachEnabled: true, apbsEnabled: true,
      // one record per part file -> two slips split into the two mocked parts
      maxRecordsPerFile: 1, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);

    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2025-06",
      employees: [
        { id: "emp-001", employeeNo: "EMP001", fullName: "Jane",
          basicMinor: "5000", payStructureId: null,
          bankAccountNo: "9876543210", bankIfsc: "HDFC0001234",
          pan: null, uan: null, cityClass: "X" as const,
          taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const },
        { id: "emp-002", employeeNo: "EMP002", fullName: "Ravi",
          basicMinor: "5000", payStructureId: null,
          bankAccountNo: "1112223334", bankIfsc: "HDFC0001234",
          pan: null, uan: null, cityClass: "X" as const,
          taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const },
      ],
      lopDays: {},
    });

    vi.mocked(generateBankFile).mockReturnValue({
      type: "multi",
      archiveName: "NACH_2025-06.zip",
      parts: [
        { filename: "BATCH_01.txt", content: "PART1" },
        { filename: "BATCH_02.txt", content: "PART2" },
      ],
    } as never);

    mockScopedRead
      .mockResolvedValueOnce([makeRun()])
      .mockResolvedValueOnce([makeSlip(), makeSlip({ id: "slip-002", employeeId: "emp-002", employeeNo: "EMP002" })]);

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "nach", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    expect(res.headers["content-disposition"]).toContain("NACH_2025-06.zip");
  });

  // ═══ 400/500 — invalid format query param (Zod rejects) ═════════════════
  it("rejects invalid format query param with error response", async () => {
    mockScopedRead.mockResolvedValueOnce([makeRun()]);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "xml", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // Zod validation error — not caught by HttpError handler, returned as 500
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(600);
  });

  // ═══ GAP-PAYROLL-DISBURSEMENT-02/03/06 ═══════════════════════════════════
  async function mockCsvHappyPath(runOverrides: Record<string, unknown> = {}) {
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2025-06",
      employees: [{ id: "emp-001", employeeNo: "EMP001", fullName: "John Doe",
        basicMinor: "5000", payStructureId: null,
        bankAccountNo: "1234567890", bankIfsc: "SBIN0001234",
        pan: null, uan: null, cityClass: "X" as const,
        taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const }],
      lopDays: {},
    });
    mockScopedRead
      .mockResolvedValueOnce([makeRun(runOverrides)])
      .mockResolvedValueOnce([makeSlip()]);
  }

  async function issueCalls() {
    const { issueBankFile } = await import("../src/modules/bank-transfer/issuance.js");
    return vi.mocked(issueBankFile).mock.calls.map(([input]) => input as unknown as Record<string, unknown> & {
      ctx: { actorId: string; tenantId: string }; run: { id: string }; payableSlips: unknown[];
    });
  }

  it("[DISB-02] the old GET no longer generates a file (410 USE_POST) and reads nothing", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file?format=csv`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("USE_POST");
    expect(mockScopedRead).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["too short", { reason: "short" }],
    ["whitespace padded to 10", { reason: "   abc    " }],
  ])("[DISB-02] rejects a %s reason with 400 before touching the run", async (_label, payload) => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(mockScopedRead).not.toHaveBeenCalled();
  });

  it("[DISB-02] CSV generation goes through the audited issuance with actor, reason and the payable slips", async () => {
    await mockCsvHappyPath();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const calls = await issueCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.ctx.actorId).toBe(ACTOR);
    expect(calls[0]!.ctx.tenantId).toBe(TENANT);
    expect(calls[0]!.run.id).toBe(RUN_ID);
    expect(calls[0]).toMatchObject({ format: "csv", reason: REASON, fullReissue: false, fullReissueReason: null, excludedSlips: {} });
    expect(calls[0]!.payableSlips).toHaveLength(1);
    expect(res.headers["x-bank-file-mode"]).toBe("first");
    expect(res.headers["x-bank-file-issuance-id"]).toBe("iss-1");
  });

  it("[TRANSFERS D3/R5] only payable-status slips reach the issuance (held + exception excluded); none payable is 422", async () => {
    await mockCsvHappyPath();
    mockScopedRead.mockReset();
    mockScopedRead
      .mockResolvedValueOnce([makeRun()])
      .mockResolvedValueOnce([
        makeSlip(),
        makeSlip({ id: "slip-x", employeeId: "emp-x", employeeNo: "EMPX", netPayMinor: -500n, status: "exception" }),
        makeSlip({ id: "slip-h", employeeId: "emp-001", employeeNo: "EMPH", netPayMinor: 9000n, status: "held" }),
      ]);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const ok = await app.inject({
      method: "POST", url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON }, headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain("EMPX");
    expect(ok.body).not.toContain("EMPH");
    const calls = await issueCalls();
    expect(calls[0]!.payableSlips).toHaveLength(1);
    expect(calls[0]!.excludedSlips).toEqual({ exception: 1, held: 1 });

    mockScopedRead
      .mockResolvedValueOnce([makeRun()])
      .mockResolvedValueOnce([makeSlip({ status: "held" })]);
    const none = await app.inject({
      method: "POST", url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON }, headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(none.statusCode).toBe(422);
    expect(none.json().code).toBe("NO_PAYABLE_SLIPS");
  });

  it("[TRANSFERS D2] fullReissue is admin-only (403 for payroll_officer) and needs its own reason (400), before touching the run", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const officer = await app.inject({
      method: "POST", url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON, fullReissue: true, fullReissueReason: "Bank lost the whole batch file" },
      headers: { authorization: `Bearer ${adminToken(["payroll_officer"])}` },
    });
    const noReason = await app.inject({
      method: "POST", url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: REASON, fullReissue: true },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(officer.statusCode).toBe(403);
    expect(noReason.statusCode).toBe(400);
    expect(mockScopedRead).not.toHaveBeenCalled();
  });

  it("[DISB-02] nothing is issued or audited when generation is refused (unapproved run)", async () => {
    mockScopedRead.mockResolvedValueOnce([makeRun({ status: "draft" })]);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    expect(await issueCalls()).toHaveLength(0);
  });

  it("[DISB-03] every generated file states x-bank-file-signed: false (the route does not sign)", async () => {
    await mockCsvHappyPath();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-bank-file-signed"]).toBe("false");
  });

  it("[DISB-06] refuses a NACH file when the sponsor config has NACH switched off", async () => {
    const { findByTenantId } = await import("../src/modules/sponsor-config/repo.js");
    vi.mocked(findByTenantId).mockResolvedValue({
      id: "cfg-1", tenantId: TENANT, sponsorCode: "SPON",
      sponsorIfsc: "SBIN0000001", sponsorAccount: "9999999999",
      utilityCode: "UTIL01", userNumber: "USR001",
      settlementOffsetDays: 1, nachEnabled: false, apbsEnabled: false,
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);
    mockScopedRead.mockResolvedValueOnce([makeRun()]);
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "nach", reason: REASON },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NACH_NOT_ENABLED");
    expect(await issueCalls()).toHaveLength(0);
  });
});
