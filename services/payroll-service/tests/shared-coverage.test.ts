/**
 * payroll-service — Shared module ADDITIONAL coverage tests
 *
 * Covers edge cases and branches in:
 * - context.ts: requirePermissionKey, resolveContext error paths
 * - deterministic-id.ts: additional edge cases
 * - pii-crypto.ts: keyring rotation, v1/v2 interop, encryptedText Drizzle type
 * - hrms-client.ts: timeout, abort, edge conditions
 * - outbox.ts: re-export verification
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════════════════
// context.ts — resolveContext with various error scenarios
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/context — resolveContext edge cases", () => {
  it("throws HttpError 401 when no auth header present", async () => {
    const { resolveContext, HttpError } = await import("../src/shared/context.js");
    const fakeReq = { headers: {}, raw: { headers: {} } } as never;
    try {
      resolveContext(fakeReq);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as { status: number }).status).toBe(401);
    }
  });

  it("throws HttpError when JWT is malformed", async () => {
    const { resolveContext, HttpError } = await import("../src/shared/context.js");
    const fakeReq = {
      headers: { authorization: "Bearer not.a.valid.jwt" },
      raw: { headers: { authorization: "Bearer not.a.valid.jwt" } },
    } as never;
    try {
      resolveContext(fakeReq);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as { status: number }).status).toBe(401);
    }
  });
});

describe("shared/context — requirePermissionKey", () => {
  it("rejects when permission check fails", async () => {
    const { requirePermissionKey, HttpError } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "user" as const,
      permissions: [],
    } as never;
    await expect(requirePermissionKey(ctx, "payroll:run:create"))
      .rejects.toThrow();
  });
});

describe("shared/context — isSelfServiceEmployee additional cases", () => {
  it("returns false for hr_admin role", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee", "hr_admin"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });

  it("returns false for finance_officer role", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee", "finance_officer"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });

  it("returns false for payroll_officer role", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: ["employee", "payroll_officer"],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });

  it("returns false when user has no roles at all", async () => {
    const { isSelfServiceEmployee } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "a1", tenantId: "t1", roles: [],
      correlationId: "c1", actorType: "user" as const,
    } as never;
    expect(isSelfServiceEmployee(ctx)).toBe(false);
  });
});

describe("shared/context — enforceEmployeeOwnership additional cases", () => {
  it("service_account with requestedEmployeeId passes through", async () => {
    const { enforceEmployeeOwnership } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "svc-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "service_account" as const,
    } as never;
    expect(enforceEmployeeOwnership(ctx, "emp-999")).toBe("emp-999");
  });

  it("service_account with no requestedEmployeeId throws 400", async () => {
    const { enforceEmployeeOwnership } = await import("../src/shared/context.js");
    const ctx = {
      actorId: "svc-1", tenantId: "t1", roles: ["employee"],
      correlationId: "c1", actorType: "service_account" as const,
    } as never;
    try {
      enforceEmployeeOwnership(ctx, undefined);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as { status: number }).status).toBe(400);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deterministic-id.ts — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/deterministic-id — additional cases", () => {
  it("handles empty string input", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const id = deterministicUuid("");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("handles very long input strings", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const longInput = "a".repeat(10000);
    const id = deterministicUuid(longInput);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("handles special characters in input", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const id = deterministicUuid("tenant:αβγ:emoji:🎉:null:\0");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("produces unique UUIDs for similar inputs", async () => {
    const { deterministicUuid } = await import("../src/shared/deterministic-id.js");
    const ids = new Set([
      deterministicUuid("run:2025-06:tenant-a"),
      deterministicUuid("run:2025-06:tenant-b"),
      deterministicUuid("run:2025-07:tenant-a"),
      deterministicUuid("run:2025-07:tenant-b"),
    ]);
    expect(ids.size).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// pii-crypto.ts — keyring rotation and encryptedText type
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/pii-crypto — keyring rotation", () => {
  beforeEach(() => {
    process.env.PII_ENC_KEY = "primary-master-key-at-least-16ch";
  });

  afterEach(() => {
    delete process.env.PII_ENC_KEY;
    delete process.env.PII_ENC_SALT;
    delete process.env.PII_KEY_ID;
    delete process.env.PII_ENC_KEYRING;
  });

  it("supports multiple keys in PII_ENC_KEYRING for rotation", async () => {
    process.env.PII_KEY_ID = "k2";
    process.env.PII_ENC_KEYRING = JSON.stringify({ k1: "old-retired-key-at-least-16ch" });
    const { encryptPii, decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();

    const encrypted = encryptPii("rotated-secret");
    expect(encrypted).toContain("enc:v2:k2:");
    expect(decryptPii(encrypted)).toBe("rotated-secret");
  });

  it("encryptedText Drizzle custom type is a function that returns a column builder", async () => {
    const { encryptedText, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    // encryptedText is a customType factory — calling it returns a column builder
    expect(typeof encryptedText).toBe("function");
    const col = encryptedText("test_col");
    // Column builder should be an object (Drizzle PgCustomColumnBuilder)
    expect(col).toBeDefined();
    expect(typeof col).toBe("object");
  });

  it("handles invalid JSON in PII_ENC_KEYRING gracefully", async () => {
    process.env.PII_ENC_KEYRING = "not-valid-json{{{";
    const { encryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    expect(() => encryptPii("test")).toThrow("PII_ENC_KEYRING is not valid JSON");
  });

  it("ignores keyring entries with short secrets", async () => {
    process.env.PII_ENC_KEYRING = JSON.stringify({ old: "short" });
    const { encryptPii, decryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    // Should still work with primary key (short keyring entry ignored)
    const encrypted = encryptPii("data");
    expect(decryptPii(encrypted)).toBe("data");
  });

  it("encryptPii produces different ciphertext for same plaintext (random IV)", async () => {
    const { encryptPii, resetPiiKeyCache } = await import("../src/shared/pii-crypto.js");
    resetPiiKeyCache();
    const ct1 = encryptPii("same-plaintext");
    const ct2 = encryptPii("same-plaintext");
    expect(ct1).not.toBe(ct2); // Random IV → different ciphertext each time
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// hrms-client.ts — additional edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/hrms-client — edge cases", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetchPayrollInput includes correct headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ month: "2025-06", employees: [], lopDays: {} }),
    });
    globalThis.fetch = mockFetch;
    const { fetchPayrollInput } = await import("../src/shared/hrms-client.js");
    await fetchPayrollInput("tenant-abc", "2025-06");
    expect(mockFetch).toHaveBeenCalledOnce();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain("month=2025-06");
    expect(callArgs[1].headers["x-internal"]).toBe("1");
    expect(callArgs[1].headers["x-tenant-id"]).toBe("tenant-abc");
  });

  it("fetchPayrollInput wraps TypeError (abort) as HrmsUnavailableError", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const { fetchPayrollInput, HrmsUnavailableError } = await import("../src/shared/hrms-client.js");
    await expect(fetchPayrollInput("t1", "2025-01"))
      .rejects.toThrow(HrmsUnavailableError);
  });

  it("fetchPendingPayrollRuns handles empty array response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([]),
    });
    const { fetchPendingPayrollRuns } = await import("../src/shared/hrms-client.js");
    const count = await fetchPendingPayrollRuns("tenant-1");
    expect(count).toBe(0);
  });

  it("fetchPendingPayrollRuns counts only processing and draft statuses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve([
        { status: "processing" },
        { status: "draft" },
        { status: "draft" },
        { status: "approved" },
        { status: "disbursed" },
        { status: "cancelled" },
      ]),
    });
    const { fetchPendingPayrollRuns } = await import("../src/shared/hrms-client.js");
    const count = await fetchPendingPayrollRuns("tenant-1");
    expect(count).toBe(3); // 1 processing + 2 draft
  });

  it("HrmsUnavailableError has correct code property", async () => {
    const { HrmsUnavailableError } = await import("../src/shared/hrms-client.js");
    const err = new HrmsUnavailableError("test error");
    expect(err.code).toBe("HRMS_UNAVAILABLE");
    expect(err.name).toBe("HrmsUnavailableError");
    expect(err.message).toBe("test error");
    expect(err).toBeInstanceOf(Error);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// outbox.ts — re-export verification
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/outbox — re-exports from @civitasone/outbox", () => {
  it("exports enqueue function", async () => {
    const outbox = await import("../src/shared/outbox.js");
    expect(typeof outbox.enqueue).toBe("function");
  });

  it("exports markProcessed function", async () => {
    const outbox = await import("../src/shared/outbox.js");
    expect(typeof outbox.markProcessed).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HttpError — structural tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("shared/context — HttpError structural", () => {
  it("HttpError is throwable and catchable", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(422, "BUSINESS_RULE", "cannot process");
    expect(err.status).toBe(422);
    expect(err.code).toBe("BUSINESS_RULE");
    expect(err.message).toBe("cannot process");
    expect(err.stack).toBeDefined();
  });

  it("HttpError inherits from Error", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(500, "INTERNAL", "oops");
    expect(err instanceof Error).toBe(true);
    expect(err.name).toBe("Error");
  });

  it("various HTTP status codes work", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const codes = [400, 401, 403, 404, 409, 422, 500];
    for (const code of codes) {
      const err = new HttpError(code, "TEST", `error ${code}`);
      expect(err.status).toBe(code);
    }
  });
});
