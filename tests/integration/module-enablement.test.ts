/**
 * Module enablement enforcement — integration tests.
 *
 * Verifies the three layers of module enforcement work correctly:
 * 1. Gateway module-guard rejects requests when a module is disabled (403 MODULE_DISABLED)
 * 2. Gateway module-guard allows requests when a module is enabled
 * 3. Domain-level assertModuleEnabled throws DomainError when disabled
 *
 * These tests exercise the module-guard logic in isolation (no real HTTP/Fastify)
 * by mocking the admin-service response and validating the guard's decision logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DomainError, assertModuleEnabled } from "../../services/admin-service/src/modules/config/domain.js";

// --- Mock the global fetch for gateway module-guard tests ---
const mockFetchResponse = vi.fn<() => Promise<Response>>();
vi.stubGlobal("fetch", mockFetchResponse);

// Import after mocking fetch
const { checkModuleEnabled, invalidateModuleCache, _test } =
  await import("../../services/gateway-service/src/module-guard.js");

const TENANT_ID = "11111111-aaaa-4000-8000-000000000001";

function makeFakeRequest(tenantId: string | null, requestId = "req-001") {
  return {
    headers: {
      "x-tenant-id": tenantId,
    },
    id: requestId,
  } as unknown as import("fastify").FastifyRequest;
}

function makeFakeReply() {
  let sentStatus = 0;
  let sentBody: unknown = null;
  const reply = {
    code(status: number) {
      sentStatus = status;
      return reply;
    },
    send(body: unknown) {
      sentBody = body;
      return reply;
    },
    get _status() { return sentStatus; },
    get _body() { return sentBody; },
  };
  return reply as unknown as import("fastify").FastifyReply & { _status: number; _body: unknown };
}

function mockAdminResponse(modules: Array<{ name: string }>, ok = true) {
  mockFetchResponse.mockResolvedValue({
    ok,
    json: async () => ({ data: modules }),
  } as Response);
}

beforeEach(() => {
  // Clear module cache between tests
  _test.moduleCache.clear();
  mockFetchResponse.mockReset();
});

describe("Gateway module-guard: checkModuleEnabled", () => {
  describe("module disabled → 403 MODULE_DISABLED", () => {
    it("rejects finance route when finance module is not in enabled list", async () => {
      mockAdminResponse([{ name: "hrms" }, { name: "procurement" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "finance");

      expect(allowed).toBe(false);
      expect(reply._status).toBe(403);
      expect((reply._body as Record<string, unknown>).code).toBe("MODULE_DISABLED");
      expect((reply._body as Record<string, unknown>).message).toContain("finance");
    });

    it("rejects hr route (maps to hrms module) when hrms is disabled", async () => {
      mockAdminResponse([{ name: "finance" }, { name: "procurement" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "hr");

      expect(allowed).toBe(false);
      expect(reply._status).toBe(403);
      expect((reply._body as Record<string, unknown>).message).toContain("hrms");
    });

    it("rejects estab route (maps to establishment module) when disabled", async () => {
      mockAdminResponse([{ name: "finance" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "estab");

      expect(allowed).toBe(false);
      expect((reply._body as Record<string, unknown>).message).toContain("establishment");
    });
  });

  describe("module enabled → allows access", () => {
    it("allows finance route when finance module is enabled", async () => {
      mockAdminResponse([{ name: "finance" }, { name: "hrms" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "finance");

      expect(allowed).toBe(true);
    });

    it("allows hr route when hrms module is enabled", async () => {
      mockAdminResponse([{ name: "hrms" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "hr");

      expect(allowed).toBe(true);
    });

    it("allows procurement route when procurement module is enabled", async () => {
      mockAdminResponse([{ name: "procurement" }, { name: "finance" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "procurement");

      expect(allowed).toBe(true);
    });
  });

  describe("platform routes always bypass module check", () => {
    it("allows identity route without checking modules", async () => {
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "identity");

      expect(allowed).toBe(true);
      expect(mockFetchResponse).not.toHaveBeenCalled();
    });

    it("allows admin route without checking modules", async () => {
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "admin");

      expect(allowed).toBe(true);
      expect(mockFetchResponse).not.toHaveBeenCalled();
    });

    it("allows audit route without checking modules", async () => {
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "audit");

      expect(allowed).toBe(true);
      expect(mockFetchResponse).not.toHaveBeenCalled();
    });
  });

  describe("graceful fallback on missing context", () => {
    it("allows request when no tenant ID is present", async () => {
      const req = makeFakeRequest(null);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "finance");

      expect(allowed).toBe(true);
      expect(mockFetchResponse).not.toHaveBeenCalled();
    });

    it("allows request when admin-service is unreachable", async () => {
      mockFetchResponse.mockRejectedValue(new Error("ECONNREFUSED"));
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "finance");

      expect(allowed).toBe(true);
    });

    it("allows request for unknown route names (conservative)", async () => {
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      const allowed = await checkModuleEnabled(req, reply, "unknown-service");

      expect(allowed).toBe(true);
      expect(mockFetchResponse).not.toHaveBeenCalled();
    });
  });

  describe("caching and invalidation", () => {
    it("uses cached modules on second call (no second fetch)", async () => {
      mockAdminResponse([{ name: "finance" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      await checkModuleEnabled(req, reply, "finance");
      await checkModuleEnabled(req, reply, "finance");

      expect(mockFetchResponse).toHaveBeenCalledTimes(1);
    });

    it("invalidateModuleCache forces a fresh fetch", async () => {
      mockAdminResponse([{ name: "finance" }]);
      const req = makeFakeRequest(TENANT_ID);
      const reply = makeFakeReply();

      await checkModuleEnabled(req, reply, "finance");
      invalidateModuleCache(TENANT_ID);
      await checkModuleEnabled(req, reply, "finance");

      expect(mockFetchResponse).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Domain function: assertModuleEnabled", () => {
  it("throws DomainError with MODULE_DISABLED code when module is disabled", () => {
    expect(() => assertModuleEnabled(false, "procurement")).toThrow(DomainError);
    try {
      assertModuleEnabled(false, "procurement");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("MODULE_DISABLED");
      expect((err as DomainError).message).toContain("procurement");
    }
  });

  it("does not throw when module is enabled", () => {
    expect(() => assertModuleEnabled(true, "finance")).not.toThrow();
  });
});
