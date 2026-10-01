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
      maxRecordsPerFile: 100000, maxAmountPerFileMinor: 1000000000n,
      createdAt: new Date(), updatedAt: new Date(), createdBy: ACTOR, updatedBy: ACTOR,
    } as never);

    vi.mocked(fetchPayrollInput).mockResolvedValue({
      month: "2025-06",
      employees: [{ id: "emp-001", employeeNo: "EMP001", fullName: "Jane",
        basicMinor: "5000", payStructureId: null,
        bankAccountNo: "9876543210", bankIfsc: "HDFC0001234",
        pan: null, uan: null, cityClass: "X" as const,
        taxRegime: "new" as const, departmentId: "d1", pensionScheme: "NPS" as const }],
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
      .mockResolvedValueOnce([makeSlip()]);

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

  async function auditCalls() {
    const { queue } = await import("../src/shared/infra.js");
    return vi.mocked(queue.publish).mock.calls.filter(([topic]) => topic === "audit.event.record");
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

  it("[DISB-02] CSV generation writes an audit row with actor, reason and totals (the CSV path used to write none)", async () => {
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
    const calls = await auditCalls();
    expect(calls).toHaveLength(1);
    const msg = calls[0][1] as { actorId: string; tenantId: string; payload: { action: string; resourceId: string; detail: Record<string, unknown> } };
    expect(msg.actorId).toBe(ACTOR);
    expect(msg.tenantId).toBe(TENANT);
    expect(msg.payload.action).toBe("bank_file_generated");
    expect(msg.payload.resourceId).toBe(RUN_ID);
    expect(msg.payload.detail).toMatchObject({
      format: "csv", recordCount: 1, totalAmountMinor: "8000", reason: REASON, reissue: false, signed: false,
    });
  });

  it("[DISB-02] a file for a disbursed (paid) run is audited as a re-issue", async () => {
    await mockCsvHappyPath({ status: "disbursed" });
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/payroll/runs/${RUN_ID}/bank-file`,
      payload: { format: "csv", reason: "Re-issue after SBI rejected batch 3" },
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const calls = await auditCalls();
    const msg = calls[0][1] as { payload: { action: string; detail: Record<string, unknown> } };
    expect(msg.payload.action).toBe("bank_file_reissued");
    expect(msg.payload.detail.reissue).toBe(true);
  });

  it("[DISB-02] no audit row is written when generation is refused (unapproved run)", async () => {
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
    expect(await auditCalls()).toHaveLength(0);
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
    expect(await auditCalls()).toHaveLength(0);
  });
});
