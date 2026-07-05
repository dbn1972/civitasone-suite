/**
 * payroll-service — Form 16 Verify routes integration tests
 *
 * Covers:
 * - POST /v1/payroll/tax/form16/verify — signed PDF → valid: true
 * - POST /v1/payroll/tax/form16/verify — unsigned PDF → valid: false, issues: ["no_signature"]
 * - POST /v1/payroll/tax/form16/verify — non-PDF → 400
 * - 401 no token
 */
import { describe, it, expect, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";

function userToken(roles = ["employee"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}

// Mock @civitasone/render — control verifyPdfSignature behavior
vi.mock("@civitasone/render", () => ({
  verifyPdfSignature: vi.fn((buf: Buffer) => {
    const content = buf.toString("binary");
    // If the buffer contains a /ByteRange marker, treat it as "signed"
    if (content.includes("/ByteRange")) {
      return {
        valid: true,
        signerCN: "Test Signer CN",
        signedAt: "2025-01-15T10:30:00Z",
        serialNumber: "0A1B2C",
        certificateExpiry: "2026-12-31T23:59:59.000Z",
        issues: [],
      };
    }
    // Otherwise treat as unsigned
    return {
      valid: false,
      signerCN: undefined,
      signedAt: undefined,
      serialNumber: undefined,
      certificateExpiry: undefined,
      issues: ["no_signature"],
    };
  }),
  // Also export other render mocks needed by app.ts transitive imports
  renderPdf: vi.fn(),
  signPdfWithDsc: vi.fn(),
  validateDscCertificate: vi.fn(),
  DscValidationError: class extends Error {
    public readonly code: string;
    constructor(msg: string, code: string) { super(msg); this.code = code; }
  },
}));

// Mock storage (needed by dsc-config routes that are registered in the same app)
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock")),
  deleteObject: vi.fn(async () => undefined),
  presignedGetUrl: vi.fn(async () => "https://s3.example.com/presigned"),
}));

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/verify — signed PDF
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/verify — signed PDF", () => {
  it("returns valid: true for a signed PDF (JSON body)", async () => {
    // Create a fake "signed PDF" buffer that has %PDF magic and /ByteRange marker
    const fakePdf = Buffer.from("%PDF-1.7 fake content /ByteRange [0 100 200 300] /Contents <abc>");
    const pdfBase64 = fakePdf.toString("base64");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken()}`,
        "content-type": "application/json",
      },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(true);
    expect(body.data.signerCN).toBe("Test Signer CN");
    expect(body.data.signedAt).toBe("2025-01-15T10:30:00Z");
    expect(body.data.certificateExpiry).toBe("2026-12-31T23:59:59.000Z");
    expect(body.data.issues).toEqual([]);
  });

  it("returns valid: true for a signed PDF (raw body)", async () => {
    const fakePdf = Buffer.from("%PDF-1.7 raw signed content /ByteRange [0 50 150 200]");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken()}`,
        "content-type": "application/pdf",
      },
      payload: fakePdf,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/verify — unsigned PDF
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/verify — unsigned PDF", () => {
  it("returns valid: false with no_signature issue", async () => {
    // PDF without /ByteRange marker → "unsigned"
    const fakePdf = Buffer.from("%PDF-1.7 some plain content without signature markers");
    const pdfBase64 = fakePdf.toString("base64");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken()}`,
        "content-type": "application/json",
      },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.valid).toBe(false);
    expect(body.data.signerCN).toBeNull();
    expect(body.data.signedAt).toBeNull();
    expect(body.data.issues).toContain("no_signature");
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/tax/form16/verify — non-PDF → 400
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/verify — non-PDF", () => {
  it("returns 400 INVALID_FORMAT for non-PDF content", async () => {
    // Text that doesn't start with %PDF
    const notPdf = Buffer.from("This is a plain text file, not a PDF");
    const pdfBase64 = notPdf.toString("base64");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken()}`,
        "content-type": "application/json",
      },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_FORMAT");
  });

  it("returns 400 for empty body", async () => {
    const pdfBase64 = Buffer.from("").toString("base64");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken()}`,
        "content-type": "application/json",
      },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Auth — 401 no token
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/verify — 401 no token", () => {
  it("returns 401 when no auth header", async () => {
    const app = await buildApp();
    const fakePdf = Buffer.from("%PDF-1.7 some content");
    const pdfBase64 = fakePdf.toString("base64");

    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: { "content-type": "application/json" },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Auth — any role can access (not restricted to admin)
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/tax/form16/verify — role access", () => {
  it("allows payroll_admin role", async () => {
    const fakePdf = Buffer.from("%PDF-1.7 admin test content");
    const pdfBase64 = fakePdf.toString("base64");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken(["payroll_admin"])}`,
        "content-type": "application/json",
      },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });

  it("allows citizen role (any authenticated user)", async () => {
    const fakePdf = Buffer.from("%PDF-1.7 citizen test content");
    const pdfBase64 = fakePdf.toString("base64");

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax/form16/verify",
      headers: {
        authorization: `Bearer ${userToken(["citizen"])}`,
        "content-type": "application/json",
      },
      payload: { pdfBase64 },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
  });
});
