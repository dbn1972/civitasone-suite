/**
 * payroll-service — Form 16 PDF route integration tests
 *
 * Covers:
 * - ?output=pdf returns content-type application/pdf
 * - ?output=html returns content-type text/html
 * - X-DSC-Signed header present in both cases
 * - Employee role can access own Form 16 but not another employee's
 * - Self-service enforcement (employee cannot access other employees)
 * - 503 when PDF renderer unavailable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const EMPLOYEE_ID = "aaaaaaaa-bbbb-4000-8000-000000000001";
const OTHER_EMPLOYEE_ID = "aaaaaaaa-bbbb-4000-8000-000000000002";

function adminToken() {
  return signToken({ sub: EMPLOYEE_ID, tid: TENANT, roles: ["payroll_admin", "super_admin"], sid: "s1" }, SECRET);
}
function employeeToken(empId = EMPLOYEE_ID) {
  return signToken({ sub: empId, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Mock buildForm16 to avoid needing a real DB with payroll data
vi.mock("../src/modules/tax/form16.js", () => ({
  parseFy: vi.fn((fy: string) => {
    const m = /^(\d{4})-(\d{2})$/.exec(fy);
    if (!m) throw new Error("fy must be in format YYYY-YY");
    const startYear = parseInt(m[1]!, 10);
    const suffix = parseInt(m[2]!, 10);
    if (suffix !== (startYear + 1) % 100) throw new Error("invalid FY suffix");
    return { startYear, endYear: startYear + 1 };
  }),
  buildForm16: vi.fn(async (_tenantId: string, employeeId: string, fy: string) => ({
    employeeId,
    fy,
    assessmentYear: "2026-27",
    form16PartA: {
      deductor: { name: "Test Org", tan: "ABCD12345E", pan: "AAACT1234F" },
      deductee: { name: "Test Employee", pan: "ABCDE1234F", panFlag: "" },
      quarterlyTds: { Q1: 25000, Q2: 25000, Q3: 25000, Q4: 25000 },
      totalTdsDeposited: 100000,
      note: "This is a computer-generated Form 16.",
    },
    form16PartB: {
      grossSalary: 1200000, perquisites: 0, prevEmployerSalary: 0, otherSourcesIncome: 0,
      standardDeduction: 50000, hraExempt: 120000,
      section80c: 150000, section80d: 25000, otherDeductions: 0, totalChapterViA: 175000,
      taxableIncome: 855000, taxOnIncome: 112500, rebate87A: 0, surcharge: 0, cess: 4500,
      totalTaxLiability: 117000, totalTdsDeducted: 100000, prevEmployerTds: 0,
      balanceTaxPayable: 17000, refundDue: 0, regime: "old" as const,
    },
  })),
}));

// Mock @civitasone/render for PDF rendering
vi.mock("@civitasone/render", () => {
  const MockDscValidationError = class extends Error {
    public readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "DscValidationError";
      this.code = code;
    }
  };

  return {
    renderPdf: vi.fn(async () => ({
      buffer: Buffer.from("%PDF-1.7 mock pdf content"),
      pages: 1,
      mode: "playwright",
      signed: false,
    })),
    signPdfWithDsc: vi.fn(async (pdfBuffer: Buffer) => ({
      buffer: Buffer.from("%PDF-1.7 signed pdf content"),
      signerCN: "Test Signer CN",
      signedAt: new Date().toISOString(),
      serialNumber: "0A1B2C3D",
      sha256Fingerprint: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    })),
    DscValidationError: MockDscValidationError,
    validateDscCertificate: vi.fn(),
  };
});

// Mock DSC loader
vi.mock("../src/modules/dsc-config/loader.js", () => ({
  loadDsc: vi.fn(async () => ({
    p12Buffer: Buffer.from("mock-p12"),
    passphrase: "mock-pass",
    certInfo: {
      subjectCN: "Test Signer CN",
      serialNumber: "0A1B2C3D",
      notBefore: new Date("2024-01-01"),
      notAfter: new Date("2026-12-31"),
      sha256Fingerprint: "abcdef1234567890",
      keyUsage: ["digitalSignature"],
    },
  })),
}));

// Mock outbox enqueue
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
}));

// Mock DB — the select chain returns different things depending on context.
// For loadTaxConfig → returns iterable rows (empty). For payrollSlips → returns array with employeeNo.
vi.mock("../src/shared/db.js", () => {
  const createChain = (result: unknown[]) => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(() => result),
        // For cases that don't call .limit()
        [Symbol.iterator]: function* () { yield* result; },
      })),
      // For loadTaxConfig which chains: select().from(table) → iterable
      [Symbol.iterator]: function* () { yield* result; },
      limit: vi.fn(() => result),
    })),
  });
  const mockSelect = vi.fn(() => createChain([{ employeeNo: "EMP001" }]));
  const mockTransaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({}));
  return {
    db: { select: mockSelect, transaction: mockTransaction },
    // scopedRead wraps a read in db.transaction in prod; here run the callback
    // with a tx that exposes the same mocked select chain.
    scopedRead: (fn: (tx: unknown) => unknown) => fn({ select: mockSelect }),
    sqlClient: { end: vi.fn() },
  };
});

// Mock loadTaxConfig to avoid DB dependency during app.build
vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(async () => 0),
}));

// Mock infra (cache, queue)
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn(), invalidate: vi.fn(), ping: vi.fn(async () => "PONG") },
  queue: { publish: vi.fn(async () => undefined), subscribe: vi.fn() },
}));

// Mock @civitasone/storage
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock-p12-data")),
  deleteObject: vi.fn(async () => undefined),
}));

// ═══════════════════════════════════════════════════════════════════
// ?output=pdf returns content-type application/pdf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/:employeeId/pdf?output=pdf", () => {
  it("returns application/pdf content-type with DSC signed", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["x-dsc-signed"]).toBe("true");
    expect(res.headers["content-disposition"]).toContain("Form16_");
    expect(res.headers["content-disposition"]).toContain("2025-26");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });

  it("defaults to pdf output when ?output is not specified", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });
});

// ═══════════════════════════════════════════════════════════════════
// ?output=html returns content-type text/html
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/form16/:employeeId/pdf?output=html", () => {
  it("returns text/html content-type (backward compat)", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Form 16");
    expect(res.body).toContain("<!DOCTYPE html>");
  });

  it("sets X-DSC-Signed: false for HTML output", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.headers["x-dsc-signed"]).toBe("false");
  });
});

// ═══════════════════════════════════════════════════════════════════
// X-DSC-Signed header present in both cases
// ═══════════════════════════════════════════════════════════════════

describe("X-DSC-Signed header", () => {
  it("is 'true' when DSC is available (PDF output)", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.headers["x-dsc-signed"]).toBe("true");
  });

  it("is 'false' when no DSC is configured (PDF output)", async () => {
    // Override loadDsc mock to return null (no DSC available)
    const { loadDsc } = await import("../src/modules/dsc-config/loader.js");
    vi.mocked(loadDsc).mockResolvedValueOnce(null);

    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["x-dsc-signed"]).toBe("false");
    expect(res.headers["content-type"]).toBe("application/pdf");
  });

  it("is 'false' for HTML output", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.headers["x-dsc-signed"]).toBe("false");
  });
});

// ═══════════════════════════════════════════════════════════════════
// Self-service access: employee can access own but not another's
// ═══════════════════════════════════════════════════════════════════

describe("Self-service access enforcement", () => {
  it("employee can access their own Form 16", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=html`,
      headers: { authorization: `Bearer ${employeeToken(EMPLOYEE_ID)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("employee cannot access another employee's Form 16", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${OTHER_EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${employeeToken(EMPLOYEE_ID)}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("FORBIDDEN");
  });

  it("admin can access any employee's Form 16", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${OTHER_EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Error handling
// ═══════════════════════════════════════════════════════════════════

describe("Form 16 PDF — error handling", () => {
  it("returns 503 when PDF renderer is unavailable", async () => {
    const { renderPdf } = await import("@civitasone/render");
    vi.mocked(renderPdf).mockResolvedValueOnce({
      buffer: Buffer.from("html"),
      mode: "html-only",
      signed: false,
    });

    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.code).toBe("PDF_RENDERER_UNAVAILABLE");
  });

  it("returns 400 for invalid FY format", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-99&output=pdf`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when no auth header", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/tax/form16/${EMPLOYEE_ID}/pdf?fy=2025-26&output=pdf`,
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});
