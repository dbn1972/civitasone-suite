/**
 * Shared utility tests — context.ts, deterministic-id.ts, pii-crypto.ts, hrms-client.ts
 *
 * Tests pure functions, error paths, and edge cases in the payroll-service shared layer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// context.ts — HttpError, resolveContext, requireRole, isSelfServiceEmployee,
//              enforceEmployeeOwnership
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/context — HttpError", () => {
  it("creates an error with status, code, and message", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(404, "NOT_FOUND", "resource not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("resource not found");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("shared/context — requireRole", () => {
  it("throws 403 when caller has no matching role", async () => {
    const { requireRole, HttpError } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(() => requireRole(ctx, ["payroll_admin", "super_admin"]))
      .toThrowError("requires one of");
  });

  it("passes when caller has a matching role", async () => {
    const { requireRole } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["payroll_admin"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(() => requireRole(ctx, ["payroll_admin", "super_admin"]))
      .not.toThrow();
  });
});

describe("shared/context — isSelfServiceEmployee", () => {
  it("returns true for employee role without privileged roles", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "emp-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(true);
  });

  it("returns false for service_account", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "svc-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "service_account" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });

  it("returns false when caller has payroll_admin role", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee", "payroll_admin"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });

  it("returns false when caller has super_admin role", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee", "super_admin"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });
});

describe("shared/context — enforceEmployeeOwnership", () => {
  it("returns actorId for self-service employee with no requested id", async () => {
    const { enforceEmployeeOwnership } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "emp-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(enforceEmployeeOwnership(ctx, undefined)).toBe("emp-1");
  });

  it("returns actorId when self-service employee requests own id", async () => {
    const { enforceEmployeeOwnership } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "emp-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(enforceEmployeeOwnership(ctx, "emp-1")).toBe("emp-1");
  });

  it("throws 403 when self-service employee requests another employee id", async () => {
    const { enforceEmployeeOwnership, HttpError } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "emp-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(() => enforceEmployeeOwnership(ctx, "emp-999")).toThrow();
    try {
      enforceEmployeeOwnership(ctx, "emp-999");
    } catch (e) {
      expect((e as { status: number }).status).toBe(403);
    }
  });

  it("passes through requested id for privileged roles", async () => {
    const { enforceEmployeeOwnership } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "admin-1", tenantId: "t1", roles: ["payroll_admin"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(enforceEmployeeOwnership(ctx, "emp-999")).toBe("emp-999");
  });

  it("throws 400 when privileged role has no employeeId", async () => {
    const { enforceEmployeeOwnership } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "admin-1", tenantId: "t1", roles: ["payroll_admin"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(() => enforceEmployeeOwnership(ctx, undefined)).toThrow();
    try {
      enforceEmployeeOwnership(ctx, undefined);
    } catch (e) {
      expect((e as { status: number }).status).toBe(400);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deterministic-id.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/deterministic-id — deterministicUuid", () => {
  it("produces a valid UUID format", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const id = deterministicUuid("test-input");
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("is deterministic — same input yields same output", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const a = deterministicUuid("payroll-run:2025-06:tenant-abc");
    const b = deterministicUuid("payroll-run:2025-06:tenant-abc");
    expect(a).toBe(b);
  });

  it("different inputs produce different UUIDs", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const a = deterministicUuid("input-a");
    const b = deterministicUuid("input-b");
    expect(a).not.toBe(b);
  });

  it("version nibble is 5 (UUID v5)", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const id = deterministicUuid("any-input");
    // 13th hex char (version position) must be '5'
    expect(id[14]).toBe("5");
  });

  it("variant bits are correct (RFC-4122)", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const id = deterministicUuid("variant-check");
    // 19th hex char (variant position) must be 8, 9, a, or b
    expect("89ab").toContain(id[19]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// pii-crypto.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/pii-crypto — encrypt/decrypt roundtrip", () => {
  beforeEach(() => {
    process.env.PII_ENC_KEY = "test-master-secret-at-least-16-chars-long";
    // Force re-derivation
  });

  afterEach(() => {
    delete process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_SALT;
    delete process.env.PII_KEY_ID;
    delete process.env.PII_ENC_KEYRING;
  });

  it("encrypts and decrypts plain text correctly", async () => {
    const { encryptPii, decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    const original = "sensitive-bank-account-123456";
    const encrypted = encryptPii(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.startsWith("enc:v2:")).toBe(true);
    const decrypted = decryptPii(encrypted);
    expect(decrypted).toBe(original);
  });

  it("isEncrypted detects encrypted values", async () => {
    const { encryptPii, isEncrypted, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    const encrypted = encryptPii("test");
    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted("plain-text")).toBe(false);
    expect(isEncrypted("enc:v1:base64data")).toBe(true);
  });

  it("decryptPii passes through plain text (not encrypted)", async () => {
    const { decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    expect(decryptPii("just-plain-text")).toBe("just-plain-text");
  });

  it("decryptPii throws PiiDecryptError on tampered ciphertext", async () => {
    const { encryptPii, decryptPii, PiiDecryptError, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    const encrypted = encryptPii("secret");
    // Tamper with the payload
    const tampered = encrypted.slice(0, -5) + "XXXXX";
    expect(() => decryptPii(tampered)).toThrow(PiiDecryptError);
  });

  it("decryptPii throws PiiDecryptError for malformed v2 envelope", async () => {
    const { decryptPii, PiiDecryptError, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    // Missing key id separator
    expect(() => decryptPii("enc:v2:nocolon")).toThrow(PiiDecryptError);
  });

  it("decryptPii throws for unknown key id", async () => {
    const { decryptPii, PiiDecryptError, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    // Fabricate a v2 envelope with unknown key id
    expect(() => decryptPii("enc:v2:unknown_key:AAAA")).toThrow(PiiDecryptError);
  });

  it("throws when PII_ENC_KEY is missing", async () => {
    delete process.env.PII_ENC_KEY;
    const { encryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    expect(() => encryptPii("test")).toThrow("PII_ENC_KEY is required");
  });

  it("throws when PII_ENC_KEY is too short", async () => {
    process.env.PII_ENC_KEY = "short";
    const { encryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    expect(() => encryptPii("test")).toThrow("PII_ENC_KEY is required");
  });

  it("supports custom PII_KEY_ID", async () => {
    process.env.PII_KEY_ID = "mykey";
    const { encryptPii, decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    const encrypted = encryptPii("data");
    expect(encrypted).toContain("enc:v2:mykey:");
    expect(decryptPii(encrypted)).toBe("data");
  });

  it("supports custom PII_ENC_SALT", async () => {
    process.env.PII_ENC_SALT = "custom-salt-value";
    const { encryptPii, decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    const encrypted = encryptPii("salted-data");
    expect(decryptPii(encrypted)).toBe("salted-data");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// hrms-client.ts
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/hrms-client — fetchPayrollInput", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws HrmsUnavailableError on network failure", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { fetchPayrollInput, HrmsUnavailableError } = await import("../src/shared/hrms-client.js");
    await expect(fetchPayrollInput("tenant-1", "2025-06"))
      .rejects.toThrow(HrmsUnavailableError);
  });

  it("throws HrmsUnavailableError on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const { fetchPayrollInput, HrmsUnavailableError } = await import("../src/shared/hrms-client.js");
    await expect(fetchPayrollInput("tenant-1", "2025-06"))
      .rejects.toThrow(HrmsUnavailableError);
  });

  it("returns parsed JSON on success", async () => {
    const mockData = { month: "2025-06", employees: [], lopDays: {} };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve(mockData),
    });
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    const result = await fetchPayrollInput("tenant-1", "2025-06");
    expect(result).toEqual(mockData);
  });
});

describe("shared/hrms-client — fetchPendingPayrollRuns", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 0 on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const { fetchPendingPayrollRuns } = await import("../src/shared/hrms-client.js");
    const count = await fetchPendingPayrollRuns("tenant-1");
    expect(count).toBe(0);
  });

  it("counts processing and draft runs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([
        { status: "processing" },
        { status: "draft" },
        { status: "approved" },
        { status: "disbursed" },
      ]),
    });
    const { fetchPendingPayrollRuns } = await import("../src/shared/hrms-client.js");
    const count = await fetchPendingPayrollRuns("tenant-1");
    expect(count).toBe(2);
  });

  it("returns 0 when no pending runs", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([{ status: "approved" }]),
    });
    const { fetchPendingPayrollRuns } = await import("../src/shared/hrms-client.js");
    const count = await fetchPendingPayrollRuns("tenant-1");
    expect(count).toBe(0);
  });
});
