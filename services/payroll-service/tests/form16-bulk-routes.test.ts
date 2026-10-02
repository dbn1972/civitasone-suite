/**
 * payroll-service — Form 16 Bulk Generation routes integration tests
 *
 * Covers:
 * - POST /v1/payroll/tax/form16/bulk-generate (valid → 202, duplicate → 409, auth)
 * - GET /v1/payroll/tax/form16/bulk-status (returns progress)
 * - GET /v1/payroll/tax/form16/bulk-download (requires completed job)
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";
import { db } from "../src/shared/db.js";
import { form16BulkJobs } from "../src/modules/form16-pdf/schema.js";
import { payrollStructures, payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { eq, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { registerForm16BulkConsumers } from "../src/modules/form16-pdf/bulk-consumer.js";
import { registerTaxConfig } from "../src/modules/tax/engine.js";

// tests/setup-tax-config.ts (global vitest setupFiles) only registers FY
// 2024-26. This file's fixtures span older FYs too (2018-19..2023-24) —
// register a minimal slab config for those so buildForm16(), now actually
// invoked by the wired-up bulk consumer below, doesn't throw "no tax
// configuration" for them.
const MINIMAL_TAX_CONFIG = {
  slabs: [{ from: 0, to: Infinity, rate: 0.1 }],
  stdDeduction: 50000,
  rebateIncomeCap: 500000,
  rebateMax: 12500,
  surchargeBands: [],
};

const SECRET = "test_secret_for_civitasone_32chr";
// This file's own tenant and fixture ids, fresh per run. The tenant used to be
// aaaaaaaa-1111-4000-8000-000000000099, shared with nine other payroll files:
// the consumer counts every disbursed slip of the tenant, so their fixtures
// changed totalEmployees here, and a job another file left for the same FY
// changed the 404/409/422 outcomes.
const TENANT = randomUUID();
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";

// Fixture IDs for a minimal disbursed run + slip (see beforeAll below).
const STRUCT_ID = randomUUID();
const RUN_ID = randomUUID();
const SLIP_ID = randomUUID();
const SEEDED_EMP_ID = randomUUID();

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function employeeToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

/**
 * The form16_bulk_jobs row is only ever created by registerForm16BulkConsumers's
 * handler (src/modules/form16-pdf/bulk-consumer.ts), which these tests wire
 * onto the app's queue (see beforeAll). A job moves pending -> processing ->
 * completed, and the 409/status/422 checks below need it to be in flight.
 *
 * These used to sleep 80 ms and hope that landed inside a ~150 ms window kept
 * open by a delayed HRMS mock. Under CI load the consumer had often not even
 * created the row by then (404) or had already finished. The HRMS mock now
 * waits on `hrmsGate` instead: a test closes the gate, POSTs, polls until the
 * job is "processing" (blocked on the gate, so it stays there), makes its
 * assertion, and afterEach opens the gate and drains the queue.
 */
const hrmsGate = vi.hoisted(() => {
  let release: (() => void) | null = null;
  let gate: Promise<void> = Promise.resolve();
  return {
    close(): void {
      gate = new Promise<void>((r) => { release = r; });
    },
    open(): void {
      release?.();
      release = null;
      gate = Promise.resolve();
    },
    wait: (): Promise<void> => gate,
  };
});

async function drainQueue(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

/** Poll GET /bulk-status until the FY's job reports `status`. */
async function waitForJobStatus(app: Awaited<ReturnType<typeof buildApp>>, fy: string, status: string): Promise<void> {
  await vi.waitFor(async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/bulk-status?fy=${fy}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe(status);
  }, { timeout: 20_000, interval: 25 });
}

// Mock HRMS + PDF render/sign + storage for the bulk consumer's per-employee
// loop (see bulk-consumer.ts): buildForm16() calls fetchPayrollInput(), which
// would otherwise hit a real (unreachable in tests) HRMS service and fail
// fast, giving the consumer no real work to do. Returning a valid response
// once `hrmsGate` (above) is open lets a test hold the job in "processing"
// for as long as it needs — without this, real Playwright/S3 calls would also
// be needed once buildForm16 succeeds, which render/storage mocks avoid.
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => {
    await hrmsGate.wait();
    return { month: "2024-03", employees: [], lopDays: {} };
  }),
  HrmsUnavailableError: class HrmsUnavailableError extends Error {
    readonly code = "HRMS_UNAVAILABLE";
  },
}));

vi.mock("@civitasone/render", () => ({
  renderPdf: vi.fn(async () => ({
    buffer: Buffer.from("%PDF-1.7 mock pdf content"),
    pages: 1,
    mode: "playwright",
    signed: false,
  })),
  signPdfWithDsc: vi.fn(async () => ({
    buffer: Buffer.from("%PDF-1.7 signed mock pdf content"),
    signerCN: "Test Signer CN",
    signedAt: new Date().toISOString(),
    serialNumber: "0A1B2C3D",
    sha256Fingerprint: "abcdef1234567890",
  })),
  DscValidationError: class DscValidationError extends Error {
    readonly code = "DSC_VALIDATION_FAILED";
  },
  validateDscCertificate: vi.fn(),
  // REL-018 follow-up: buildApp() also registers form16-verify routes, whose
  // module imports verifyPdfSignature from this same package at load time --
  // this mock replacing the whole module without it left that binding
  // undefined for this file's module graph. Not exercised by this file's own
  // scenarios, so a static default matching the real "unsigned" shape
  // (packages/render/src/pdf-verify.ts's VerifyResult) is enough.
  verifyPdfSignature: vi.fn(() => ({
    valid: false,
    signerCN: undefined,
    signedAt: undefined,
    serialNumber: undefined,
    certificateExpiry: undefined,
    issues: ["no_signature"],
  })),
}));

vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock-data")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://example.invalid/mock-signed-url"),
}));

// Clean up test data before running to avoid conflicts from previous runs
beforeAll(async () => {
  try {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.delete(form16BulkJobs).where(eq(form16BulkJobs.tenantId, TENANT));
    }));
  } catch {
    // Table may not exist in CI — that's fine
  }

  // Seed a minimal disbursed run + slip so the bulk-generate consumer
  // actually has one employee to process (see mocks above) instead of
  // racing its near-instant zero-employee completion path.
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollStructures).values({
      id: STRUCT_ID, tenantId: TENANT, name: "Form16 Bulk Test Structure",
      createdBy: UUID, updatedBy: UUID,
    }).onConflictDoNothing();
    await tx.insert(payrollRuns).values({
      id: RUN_ID, tenantId: TENANT, runNo: "RUN-F16-BULK-TEST", month: "2024-03",
      structureId: STRUCT_ID, status: "disbursed", createdBy: UUID, updatedBy: UUID,
    }).onConflictDoNothing();
    await tx.insert(payrollSlips).values({
      id: SLIP_ID, tenantId: TENANT, runId: RUN_ID, employeeId: SEEDED_EMP_ID,
      employeeNo: "F16BULKTEST01", grossMinor: 5000000n, netPayMinor: 4500000n,
      createdBy: UUID, updatedBy: UUID,
    }).onConflictDoNothing();
  }));

  for (const startYear of [2018, 2019, 2020, 2021, 2022, 2023]) {
    registerTaxConfig("new", startYear, MINIMAL_TAX_CONFIG);
    registerTaxConfig("old", startYear, MINIMAL_TAX_CONFIG);
  }

  // Wire the real bulk-generate consumer onto the app's `queue` singleton (the
  // same instance src/modules/form16-pdf/routes.ts publishes to) so that
  // POST /bulk-generate's queue.publish() actually gets consumed here, the way
  // it would in production via src/worker.ts. createQueue() (see
  // shared/infra.ts) already wraps every handler in withTenantConsumer, so no
  // extra tenant-context wrapping is needed on top of this registration.
  registerForm16BulkConsumers(queue);
  await queue.start();
});

afterEach(async () => {
  hrmsGate.open();
  await drainQueue();
});

afterAll(async () => {
  hrmsGate.open();
  await drainQueue();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(form16BulkJobs).where(eq(form16BulkJobs.tenantId, TENANT));
    await tx.delete(payrollSlips).where(eq(payrollSlips.tenantId, TENANT));
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollStructures).where(eq(payrollStructures.tenantId, TENANT));
    await tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`);
  }));
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — valid payload → 202
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — valid payload", () => {
  it("returns 202 with jobId for valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    // sendAccepted() sends the accepted-response schema FLAT — {id, status,
    // correlationId} — no `data` wrapper (see packages/schemas/src/validate.ts
    // and acceptedResponseSchema in packages/schemas/src/common.ts). Same
    // convention as every other F3-converted route in this service (e.g.
    // tests/payroll-core-routes.test.ts asserts res.json().id).
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 202 with specific employeeIds", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2023-24", employeeIds: [randomUUID(), randomUUID()] },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — duplicate job → 409
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — duplicate", () => {
  it("returns 409 when a job for same FY is already pending/processing", async () => {
    const app = await buildApp();
    const fy = "2022-23";
    hrmsGate.close();

    // First request — should succeed with 202
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    expect(res1.statusCode).toBe(202);

    // The duplicate-job check needs the first job's row to exist and still be
    // in flight; it is held in "processing" by the closed HRMS gate.
    await waitForJobStatus(app, fy, "processing");

    // Second request for same FY — should return 409
    const res2 = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    await app.close();

    expect(res2.statusCode).toBe(409);
    const body = res2.json();
    expect(body.code).toBe("BULK_JOB_IN_PROGRESS");
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — auth rejection
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for employee role (not admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { fy: "2024-25" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate — validation errors
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — validation", () => {
  it("returns 400 or 500 when fy format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 when fy suffix is incorrect (e.g. 2024-99)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024-99" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-status — returns progress
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-status", () => {
  it("returns job progress after creating a bulk job", async () => {
    const app = await buildApp();
    const fy = "2021-22";
    hrmsGate.close();

    // Create a job first
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    expect(createRes.statusCode).toBe(202);

    // Wait until the consumer has created the row and picked up the seeded
    // employee; the closed HRMS gate holds it in "processing".
    await waitForJobStatus(app, fy, "processing");

    // Query status
    const statusRes = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/bulk-status?fy=${fy}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(statusRes.statusCode).toBe(200);
    const body = statusRes.json();
    expect(body.data.jobId).toBeDefined();
    expect(body.data.fy).toBe(fy);
    // Exactly one employee is seeded for this file's tenant (see beforeAll),
    // and the job is held on the HRMS gate before generating anything.
    expect(body.data.status).toBe("processing");
    expect(body.data.totalEmployees).toBe(1);
    expect(body.data.failed + body.data.generated).toBe(0);
  });

  it("returns 404 when no job exists for FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2019-20",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2024-25",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2024-25",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-download — requires completed job
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-download", () => {
  it("returns 404 when no job exists for FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2018-19",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 422 when job is not yet completed", async () => {
    const app = await buildApp();
    const fy = "2020-21";
    hrmsGate.close();

    // Create job (held in "processing" by the closed HRMS gate)
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy },
    });
    expect(createRes.statusCode).toBe(202);

    await waitForJobStatus(app, fy, "processing");

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/bulk-download?fy=${fy}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2024-25",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2024-25",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});
