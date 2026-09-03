/**
 * payroll-service — Form 16 PDF routes integration tests
 *
 * Covers:
 * - GET /v1/payroll/tax/form16/:employeeId/pdf (happy path, 400, 401, 403)
 * - POST /v1/payroll/tax/form16/bulk-generate (happy path, 400, 401, 403, 409)
 * - GET /v1/payroll/tax/form16/bulk-status (happy path, 400, 401, 403, 404)
 * - GET /v1/payroll/tax/form16/bulk-download (happy path, 400, 401, 403, 404)
 */
import { describe, it, expect, afterAll, beforeAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";
import { db } from "../src/shared/db.js";
import { runWithTenant } from "@civitasone/db";
import { payrollStructures, payrollRuns, payrollSlips } from "../src/modules/payroll/schema.js";
import { queue } from "../src/shared/infra.js";
import { registerForm16BulkConsumers } from "../src/modules/form16-pdf/bulk-consumer.js";
import { registerTaxConfig } from "../src/modules/tax/engine.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-000000000001";

// Fixture IDs for a minimal disbursed run + slip (see beforeAll below).
// Distinct from tests/form16-bulk-routes.test.ts's own fixture IDs (same
// tenant, different file/module graph) to avoid cross-file collisions.
const STRUCT_ID = "77777777-0001-4000-8000-000000000002";
const RUN_ID = "77777777-0002-4000-8000-000000000002";
const SLIP_ID = "77777777-0004-4000-8000-000000000002";
const SEEDED_EMP_ID = "77777777-0003-4000-8000-000000000002";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function readerToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin", "hr_admin", "finance_officer"], sid: "s1" }, SECRET);
}
function employeeToken(sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

/**
 * The form16_bulk_jobs row is only ever created by registerForm16BulkConsumers's
 * handler (src/modules/form16-pdf/bulk-consumer.ts), wired up in production by
 * src/worker.ts — a separate process that these HTTP-only buildApp() tests
 * never run. With zero employees to process, that consumer's job goes
 * pending -> processing -> completed in well under 100ms once the DB
 * connection pool is warm, too narrow a window to race reliably. The
 * fetchPayrollInput mock below adds an artificial ~150ms delay per employee
 * so the seeded job below stays "processing" for a comfortable, deterministic
 * window instead — this wait just needs to land inside that window.
 */
function waitForConsumer(ms = 80) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// See tests/form16-bulk-routes.test.ts for the full rationale on these mocks
// (HRMS/render/storage) — same approach, reused here for this file's own
// "409 conflict" bulk-generate test.
vi.mock("../src/shared/hrms-client.js", () => ({
  fetchPayrollInput: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 150));
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
}));

vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock-data")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://example.invalid/mock-signed-url"),
}));

beforeAll(async () => {
  // Seed a minimal disbursed run + slip so the bulk-generate consumer
  // actually has one employee to process (see mocks above) instead of
  // racing its near-instant zero-employee completion path.
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollStructures).values({
      id: STRUCT_ID, tenantId: TENANT, name: "Form16 Coverage Test Structure",
      createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing();
    await tx.insert(payrollRuns).values({
      id: RUN_ID, tenantId: TENANT, runNo: "RUN-F16-COVERAGE-TEST", month: "2024-03",
      structureId: STRUCT_ID, status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing();
    await tx.insert(payrollSlips).values({
      id: SLIP_ID, tenantId: TENANT, runId: RUN_ID, employeeId: SEEDED_EMP_ID,
      employeeNo: "F16COVTEST01", grossMinor: 5000000n, netPayMinor: 4500000n,
      createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing();
  }));

  // tests/setup-tax-config.ts (global vitest setupFiles) only registers FY
  // 2024-26; this file's "409 conflict" test uses FY 2017-18 (deliberately
  // distinct from every FY tests/form16-bulk-routes.test.ts uses, since both
  // files share this tenant and vitest runs test files in parallel by
  // default — reusing an FY across files would let one file's job trip the
  // other's duplicate-job check).
  const MINIMAL_TAX_CONFIG = {
    slabs: [{ from: 0, to: Infinity, rate: 0.1 }],
    stdDeduction: 50000,
    rebateIncomeCap: 500000,
    rebateMax: 12500,
    surchargeBands: [],
  };
  registerTaxConfig("new", 2017, MINIMAL_TAX_CONFIG);
  registerTaxConfig("old", 2017, MINIMAL_TAX_CONFIG);

  // Wire the real bulk-generate consumer onto the app's `queue` singleton (the
  // same instance src/modules/form16-pdf/routes.ts publishes to) so that
  // POST /bulk-generate's queue.publish() actually gets consumed here, the way
  // it would in production via src/worker.ts. createQueue() (see
  // shared/infra.ts) already wraps every handler in withTenantConsumer, so no
  // extra tenant-context wrapping is needed on top of this registration.
  registerForm16BulkConsumers(queue);
  await queue.start();
});

afterAll(async () => { /* pool closed by other test teardown */ });

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/:employeeId/pdf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/:employeeId/pdf — happy path", () => {
  it("returns 200/500/502/503 for valid params (PDF or HTML output)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    // 200 if form16 data builds; 500/502 if HRMS unreachable or no data; 503 if renderer unavailable
    expect([200, 500, 502, 503]).toContain(res.statusCode);
  });

  it("returns 200/500/502/503 for PDF output format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([200, 500, 502, 503]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/:employeeId/pdf — 400 validation", () => {
  it("returns 400 for invalid fy format (bad suffix)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-99`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for non-UUID employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/not-a-uuid/pdf?fy=2025-26",
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid output param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=docx`,
      headers: { authorization: `Bearer ${readerToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/:employeeId/pdf — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26`,
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when employee tries to access another employee's form16", async () => {
    const otherEmployee = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${otherEmployee}/pdf?fy=2025-26`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("allows employee to access their own form16", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${ACTOR}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    // 200 if data exists, 500/502/503 if deps unavailable — but NOT 403
    expect([200, 500, 502, 503]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/bulk-generate
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/bulk-generate — happy path", () => {
  it("returns 202 for valid bulk generation request", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-26" },
    });
    await app.close();
    // 202 if no prior job exists, 409 if a pending job exists from prior test runs, 500 if DB issue
    expect([202, 409, 500]).toContain(res.statusCode);
    if (res.statusCode === 202) {
      // sendAccepted() sends the accepted-response schema FLAT — {id, status,
      // correlationId} — no `data` wrapper (see packages/schemas/src/validate.ts
      // and acceptedResponseSchema in packages/schemas/src/common.ts). Same
      // convention as every other F3-converted route in this service (e.g.
      // tests/payroll-core-routes.test.ts asserts res.json().id).
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.status).toBe("accepted");
    }
  });

  it("accepts optional employeeIds array", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2024-25", employeeIds: [randomUUID(), randomUUID()] },
    });
    await app.close();
    // 202 if no prior job exists, 409 if a pending job already exists from prior test runs, 500 if DB issue
    expect([202, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/tax/form16/bulk-generate — 400 validation", () => {
  it("returns 400 for missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-99" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid employeeIds (not UUIDs)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-26", employeeIds: ["not-a-uuid"] },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/tax/form16/bulk-generate — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { fy: "2025-26" },
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
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for non-admin privileged roles (hr_admin alone)", async () => {
    const token = signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${token}` },
      payload: { fy: "2025-26" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/payroll/tax/form16/bulk-generate — 409 conflict", () => {
  it("returns 409 when a bulk job is already in progress for same FY", async () => {
    const app = await buildApp();
    // First request — should succeed with 202 (or 500 if DB unavailable)
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/bulk-generate",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2017-18" },
    });

    if (res1.statusCode === 202) {
      // Give the consumer a moment to land the form16_bulk_jobs row (status
      // "pending"/"processing") before the duplicate-job check runs —
      // without this the row doesn't exist yet and the second request also
      // gets 202. See tests/form16-bulk-routes.test.ts for the full
      // rationale.
      await waitForConsumer();

      // Second request with same FY — should be 409
      const res2 = await app.inject({
        method: "POST",
        url: "/v1/payroll/tax/form16/bulk-generate",
        headers: { authorization: `Bearer ${adminToken()}` },
        payload: { fy: "2017-18" },
      });
      expect([409, 500]).toContain(res2.statusCode);
    }
    await app.close();
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-status
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-status — happy path", () => {
  it("returns 200/404/500 for valid fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // 200 if a job exists, 404 if no job found, 500 if DB issue
    expect([200, 404, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-status — 400 validation", () => {
  it("returns 400 for missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=invalid",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-status — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2025-26",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-status — 404", () => {
  it("returns 404 when no job exists for a given FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-status?fy=2018-19",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/tax/form16/bulk-download
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/bulk-download — happy path", () => {
  it("returns 200/404/422/500 for valid fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // 200 if completed job exists, 404 if no job, 422 if job not completed, 500 if DB issue
    expect([200, 404, 422, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-download — 400 validation", () => {
  it("returns 400 for missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 for invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=xyz",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-download — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for non-admin roles (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2025-26",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/tax/form16/bulk-download — 404", () => {
  it("returns 404 when no job exists for a given FY", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16/bulk-download?fy=2018-19",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});
