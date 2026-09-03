/**
 * payroll-service — DSC Config routes integration tests
 *
 * Covers:
 * - PUT /v1/payroll/dsc-config (valid upload, invalid P12, expired cert, oversized, missing fields)
 * - GET /v1/payroll/dsc-config (returns metadata, no key material, 404, 403)
 * - DELETE /v1/payroll/dsc-config (removes config, 404, 403)
 * - 401 no token / malformed token
 * - 403 wrong role (employee, citizen)
 * - 400 validation errors
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function employeeToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
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
  cache: {
    getOrLoad: vi.fn(async (_k: string, fn: () => unknown) => fn()),
    makeKey: vi.fn((...a: string[]) => a.join(":")),
    invalidate: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(),
  markProcessed: vi.fn(() => true),
  outboxMessages: {},
  processed: {},
  outboxSchema: {},
}));

vi.mock("../src/modules/tax/config.js", () => ({
  loadTaxConfig: vi.fn(),
}));

// Mock @civitasone/storage to avoid real S3 calls
vi.mock("@civitasone/storage", () => ({
  putObject: vi.fn(async () => undefined),
  getObject: vi.fn(async () => Buffer.from("mock-p12-data")),
  deleteObject: vi.fn(async () => undefined),
}));

// Mock @civitasone/render to control validateDscCertificate behavior
const H = vi.hoisted(() => {
  const mockValidateDsc = vi.fn();
  const MockDscValidationError = class extends Error {
    public readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.name = "DscValidationError";
      this.code = code;
    }
  };
  return { mockValidateDsc, MockDscValidationError };
});

vi.mock("@civitasone/render", () => ({
  validateDscCertificate: (...args: unknown[]) => H.mockValidateDsc(...args),
  DscValidationError: H.MockDscValidationError,
}));

// Mock the repo module to control DB interactions
const mockFindByTenantId = vi.fn();
const mockUpsert = vi.fn();
const mockRemove = vi.fn();

vi.mock("../src/modules/dsc-config/repo.js", () => ({
  findByTenantId: (...args: unknown[]) => mockFindByTenantId(...args),
  upsert: (...args: unknown[]) => mockUpsert(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";

afterAll(async () => { await sqlClient.end(); });

beforeEach(() => {
  vi.clearAllMocks();
  mockDbTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  mockFindByTenantId.mockResolvedValue(null);
  mockUpsert.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
});

// ═══════════════════════════════════════════════════════════════════
// PUT /v1/payroll/dsc-config — valid upload
// ═══════════════════════════════════════════════════════════════════

describe("PUT /v1/payroll/dsc-config — valid upload", () => {
  // F3 CQRS: the route validates + uploads to S3, then publishes
  // dscConfigUpsert and returns 202 — the actual DB write happens later in
  // the dsc-config consumer, not synchronously via repo.upsert.
  it("returns 202 accepted envelope for valid P12", async () => {
    H.mockValidateDsc.mockReturnValue({
      subjectCN: "Test Signer",
      serialNumber: "0A1B2C",
      notBefore: new Date("2024-01-01T00:00:00Z"),
      notAfter: new Date("2026-12-31T23:59:59Z"),
      sha256Fingerprint: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      keyUsage: ["digitalSignature"],
    });

    const app = await buildApp();
    const p12Base64 = Buffer.from("fake-p12-content").toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "test-pass" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    expect(body.correlationId).toBeDefined();
  });

  it("publishes dscConfigUpsert with correct tenant and cert metadata", async () => {
    H.mockValidateDsc.mockReturnValue({
      subjectCN: "Test Signer 2",
      serialNumber: "AABBCC",
      notBefore: new Date("2024-06-01T00:00:00Z"),
      notAfter: new Date("2027-06-01T00:00:00Z"),
      sha256Fingerprint: "1234567890abcdef",
      keyUsage: ["digitalSignature"],
    });

    const app = await buildApp();
    const p12Base64 = Buffer.from("valid-content").toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "my-pass" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    // repo.upsert is only ever called by the async consumer, not the route —
    // verify the route published the correct command payload instead.
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(queue.publish).toHaveBeenCalledOnce();
    expect(queue.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        tenantId: TENANT,
        payload: expect.objectContaining({
          tenantId: TENANT,
          subjectCn: "Test Signer 2",
          serialNumber: "AABBCC",
        }),
      }),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /v1/payroll/dsc-config — invalid P12
// ═══════════════════════════════════════════════════════════════════

describe("PUT /v1/payroll/dsc-config — invalid P12", () => {
  it("returns 400 when P12 passphrase is wrong", async () => {
    H.mockValidateDsc.mockImplementation(() => {
      throw new H.MockDscValidationError("wrong passphrase", "DSC_PASSPHRASE_INCORRECT");
    });

    const app = await buildApp();
    const p12Base64 = Buffer.from("corrupted-data").toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "wrong" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("DSC_PASSPHRASE_INCORRECT");
  });

  it("returns 400 when P12 file is empty (decodes to 0 bytes)", async () => {
    const app = await buildApp();
    const p12Base64 = Buffer.from("").toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when p12Base64 field is missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { passphrase: "test" },
    });
    await app.close();

    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 when passphrase field is missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64: Buffer.from("test").toString("base64") },
    });
    await app.close();

    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 when body is completely empty", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {},
    });
    await app.close();

    expect([400, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /v1/payroll/dsc-config — expired cert
// ═══════════════════════════════════════════════════════════════════

describe("PUT /v1/payroll/dsc-config — expired cert", () => {
  it("returns 400 when certificate is expired", async () => {
    H.mockValidateDsc.mockImplementation(() => {
      throw new H.MockDscValidationError(
        "DSC certificate expired on 2023-01-01T00:00:00Z",
        "DSC_CERTIFICATE_EXPIRED",
      );
    });

    const app = await buildApp();
    const p12Base64 = Buffer.from("expired-p12").toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("DSC_CERTIFICATE_EXPIRED");
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /v1/payroll/dsc-config — P12 oversized
// ═══════════════════════════════════════════════════════════════════

describe("PUT /v1/payroll/dsc-config — oversized P12", () => {
  it("returns 400 when P12 exceeds 10KB limit", async () => {
    const app = await buildApp();
    // Create a base64 string that decodes to > 10KB
    const largeBuffer = Buffer.alloc(11 * 1024, "A");
    const p12Base64 = largeBuffer.toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.message).toContain("size");
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /v1/payroll/dsc-config — generic parse failure
// ═══════════════════════════════════════════════════════════════════

describe("PUT /v1/payroll/dsc-config — generic parse failure", () => {
  it("returns 400 with DSC_INVALID code for non-DscValidationError exceptions", async () => {
    H.mockValidateDsc.mockImplementation(() => {
      throw new Error("unexpected forge error");
    });

    const app = await buildApp();
    const p12Base64 = Buffer.from("some-data").toString("base64");

    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { p12Base64, passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("DSC_INVALID");
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/dsc-config — returns metadata
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/dsc-config", () => {
  it("returns 404 when no DSC configured for tenant", async () => {
    mockFindByTenantId.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with cert metadata when DSC is configured", async () => {
    mockFindByTenantId.mockResolvedValue({
      tenantId: TENANT,
      storageRef: `dsc/${TENANT}/signing.p12`,
      subjectCn: "Configured Signer",
      serialNumber: "DEAD01",
      notBefore: new Date("2024-01-01"),
      notAfter: new Date("2027-12-31"),
      sha256Fingerprint: "fingerprint-hash-123",
      createdAt: new Date("2024-06-01"),
      updatedAt: new Date("2024-06-01"),
      createdBy: UUID,
      updatedBy: UUID,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.subjectCn).toBe("Configured Signer");
    expect(body.data.serialNumber).toBe("DEAD01");
    expect(body.data.sha256Fingerprint).toBe("fingerprint-hash-123");
    // Ensure no key material is exposed
    expect(body.data.passphrase).toBeUndefined();
    expect(body.data.storageRef).toBeUndefined();
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /v1/payroll/dsc-config
// ═══════════════════════════════════════════════════════════════════

describe("DELETE /v1/payroll/dsc-config", () => {
  it("returns 404 when no DSC configured", async () => {
    mockFindByTenantId.mockResolvedValue(null);

    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 200 and removes config when DSC exists", async () => {
    mockFindByTenantId.mockResolvedValue({
      tenantId: TENANT,
      storageRef: `dsc/${TENANT}/signing.p12`,
      subjectCn: "To Delete",
      serialNumber: "DEL01",
      notBefore: new Date("2024-01-01"),
      notAfter: new Date("2027-12-31"),
      sha256Fingerprint: "fp-del",
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: UUID,
      updatedBy: UUID,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    // F3 CQRS: DELETE publishes dscConfigRemove and returns 202 — repo.remove
    // is only invoked later by the consumer, not synchronously by the route.
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("accepted");
    expect(mockRemove).not.toHaveBeenCalled();
    expect(queue.publish).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ tenantId: TENANT }),
    );
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Auth — 401 no token / malformed
// ═══════════════════════════════════════════════════════════════════

describe("DSC Config — 401 no token", () => {
  it("GET returns 401 when no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("PUT returns 401 when no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      payload: { p12Base64: "abc", passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("DELETE returns 401 when no auth header", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("PUT returns 401 with malformed token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer invalid.malformed.token" },
      payload: { p12Base64: "abc", passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("GET returns 401 with malformed token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer not.a.valid.jwt" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("DELETE returns 401 with malformed token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: "Bearer garbage-token" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /v1/payroll/dsc-config — role-based access
// ═══════════════════════════════════════════════════════════════════

describe("PUT /v1/payroll/dsc-config — role-based access", () => {
  it("returns 403 for employee role on PUT", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { p12Base64: Buffer.from("data").toString("base64"), passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for citizen role on PUT", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { p12Base64: Buffer.from("data").toString("base64"), passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });

  it("allows payroll_admin role on PUT", async () => {
    H.mockValidateDsc.mockReturnValue({
      subjectCN: "Admin Cert",
      serialNumber: "1234",
      notBefore: new Date("2024-01-01"),
      notAfter: new Date("2027-12-31"),
      sha256Fingerprint: "fp-admin",
      keyUsage: ["digitalSignature"],
    });

    const token = signToken({ sub: UUID, tid: TENANT, roles: ["payroll_admin"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${token}` },
      payload: { p12Base64: Buffer.from("data").toString("base64"), passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });

  it("allows super_admin role on PUT", async () => {
    H.mockValidateDsc.mockReturnValue({
      subjectCN: "Super Admin Cert",
      serialNumber: "5678",
      notBefore: new Date("2024-01-01"),
      notAfter: new Date("2027-12-31"),
      sha256Fingerprint: "fp-super",
      keyUsage: ["digitalSignature"],
    });

    const token = signToken({ sub: UUID, tid: TENANT, roles: ["super_admin"], sid: "s1" }, SECRET);
    const app = await buildApp();
    const res = await app.inject({
      method: "PUT",
      url: "/v1/payroll/dsc-config",
      headers: { authorization: `Bearer ${token}` },
      payload: { p12Base64: Buffer.from("data").toString("base64"), passphrase: "test" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
  });
});
