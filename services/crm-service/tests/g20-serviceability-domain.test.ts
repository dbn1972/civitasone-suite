/**
 * G20 — Serviceability port domain & integration tests.
 *
 * Tests the pure domain logic (cache key computation, degradation decisions)
 * and the port behaviour via Fastify inject with a mocked HTTP adapter.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  serviceabilityCacheKey,
  fromAdapterResponse,
  degradedFromCache,
  degradedUnknown,
  type ServiceabilityResult,
} from "../src/modules/serviceability/domain.js";
import { serviceabilityQuery } from "../src/modules/serviceability/validators.js";

// ─── Domain: cache key computation ──────────────────────────────────────────

describe("serviceabilityCacheKey", () => {
  it("builds the expected key format", () => {
    const key = serviceabilityCacheKey("t-1", "110001", "400001", "parcel");
    expect(key).toBe("crm:serviceability:t-1:110001:400001:parcel");
  });

  it("produces distinct keys for different origin/destination", () => {
    const k1 = serviceabilityCacheKey("t-1", "110001", "400001", "parcel");
    const k2 = serviceabilityCacheKey("t-1", "400001", "110001", "parcel");
    expect(k1).not.toBe(k2);
  });

  it("includes tenantId for isolation", () => {
    const k1 = serviceabilityCacheKey("tenant-a", "110001", "400001", "parcel");
    const k2 = serviceabilityCacheKey("tenant-b", "110001", "400001", "parcel");
    expect(k1).not.toBe(k2);
  });

  it("includes articleType in key", () => {
    const k1 = serviceabilityCacheKey("t-1", "110001", "400001", "parcel");
    const k2 = serviceabilityCacheKey("t-1", "110001", "400001", "letter");
    expect(k1).not.toBe(k2);
  });
});

// ─── Domain: response mapping ───────────────────────────────────────────────

describe("fromAdapterResponse", () => {
  it("maps a full adapter response", () => {
    const result = fromAdapterResponse({
      serviceable: true,
      estimatedDays: 3,
      provider: "India Post",
    });
    expect(result).toEqual({
      serviceable: true,
      estimatedDays: 3,
      provider: "India Post",
      degraded: false,
    });
  });

  it("defaults optional fields to null", () => {
    const result = fromAdapterResponse({ serviceable: false });
    expect(result).toEqual({
      serviceable: false,
      estimatedDays: null,
      provider: null,
      degraded: false,
    });
  });

  it("maps null optional fields correctly", () => {
    const result = fromAdapterResponse({
      serviceable: true,
      estimatedDays: null,
      provider: null,
    });
    expect(result.estimatedDays).toBeNull();
    expect(result.provider).toBeNull();
    expect(result.degraded).toBe(false);
  });
});

// ─── Domain: degradation ────────────────────────────────────────────────────

describe("degradedFromCache", () => {
  it("marks a cached result as degraded", () => {
    const cached: ServiceabilityResult = {
      serviceable: true,
      estimatedDays: 5,
      provider: "India Post",
      degraded: false,
    };
    const result = degradedFromCache(cached);
    expect(result.degraded).toBe(true);
    expect(result.serviceable).toBe(true);
    expect(result.estimatedDays).toBe(5);
    expect(result.provider).toBe("India Post");
  });

  it("preserves all fields from the cached result", () => {
    const cached: ServiceabilityResult = {
      serviceable: false,
      estimatedDays: null,
      provider: null,
      degraded: false,
    };
    const result = degradedFromCache(cached);
    expect(result).toEqual({ ...cached, degraded: true });
  });
});

describe("degradedUnknown", () => {
  it("returns null serviceable with degraded flag", () => {
    const result = degradedUnknown();
    expect(result).toEqual({
      serviceable: null,
      estimatedDays: null,
      provider: null,
      degraded: true,
    });
  });
});

// ─── Validators ─────────────────────────────────────────────────────────────

describe("serviceabilityQuery validator", () => {
  it("accepts valid 6-digit PIN codes", () => {
    const result = serviceabilityQuery.safeParse({
      originPin: "110001",
      destinationPin: "400001",
      articleType: "parcel",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a 5-digit origin PIN", () => {
    const result = serviceabilityQuery.safeParse({
      originPin: "11001",
      destinationPin: "400001",
      articleType: "parcel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a 7-digit destination PIN", () => {
    const result = serviceabilityQuery.safeParse({
      originPin: "110001",
      destinationPin: "4000012",
      articleType: "parcel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects alphabetic PIN codes", () => {
    const result = serviceabilityQuery.safeParse({
      originPin: "abcdef",
      destinationPin: "400001",
      articleType: "parcel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty articleType", () => {
    const result = serviceabilityQuery.safeParse({
      originPin: "110001",
      destinationPin: "400001",
      articleType: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects articleType longer than 50 chars", () => {
    const result = serviceabilityQuery.safeParse({
      originPin: "110001",
      destinationPin: "400001",
      articleType: "a".repeat(51),
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing fields", () => {
    const result = serviceabilityQuery.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ─── Integration: route test via Fastify inject ─────────────────────────────

describe("GET /v1/crm/serviceability (route)", () => {
  let app: Awaited<ReturnType<typeof import("../src/app.js").buildApp>>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  const TOKEN_SECRET = "test_secret_for_civitasone_32chr";
  let signToken: typeof import("@civitasone/auth").signToken;

  const TENANT_ID = "00000000-0000-0000-0000-000000000001";
  const ACTOR_ID = "00000000-0000-0000-0000-000000000099";

  function authHeader(roles: string[] = ["crm_user"]) {
    return {
      authorization: `Bearer ${signToken({ sub: ACTOR_ID, tid: TENANT_ID, roles, sid: "sess-1" }, TOKEN_SECRET, 3600)}`,
    };
  }

  beforeEach(async () => {
    // Set env for HS256 test bypass
    process.env.JWT_SECRET = TOKEN_SECRET;
    process.env.CACHE_DRIVER = "memory";
    process.env.QUEUE_DRIVER = "memory";
    process.env.APT_ADAPTER_URL = "http://mock-adapter:3050";

    const authMod = await import("@civitasone/auth");
    signToken = authMod.signToken;

    // Mock global fetch to intercept adapter calls
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.resetModules();
    if (app) await app.close();
  });

  it("returns 200 with serviceability data on adapter success", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ serviceable: true, estimatedDays: 3, provider: "India Post" }),
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceable).toBe(true);
    expect(body.data.estimatedDays).toBe(3);
    expect(body.data.provider).toBe("India Post");
    expect(body.data.degraded).toBe(false);
  });

  it("returns 400 on invalid PIN code", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=ABC&destinationPin=400001&articleType=parcel",
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("returns 401 without auth header", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
    });

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role that is not crm_user/crm_admin/super_admin", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
      headers: authHeader(["finance_officer"]),
    });

    expect(res.statusCode).toBe(403);
  });

  it("degrades gracefully when adapter returns a non-200 status", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(true);
    expect(body.data.serviceable).toBeNull();
  });

  it("degrades gracefully when adapter throws (network error)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.degraded).toBe(true);
    expect(body.data.serviceable).toBeNull();
  });

  it("returns cached result (degraded) when adapter fails after a prior success", async () => {
    // First call succeeds — gets cached
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ serviceable: true, estimatedDays: 2, provider: "DTDC" }),
    });

    await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
      headers: authHeader(),
    });

    // Second call fails — should serve from cache
    fetchSpy.mockRejectedValueOnce(new Error("timeout"));

    const res = await app.inject({
      method: "GET",
      url: "/v1/crm/serviceability?originPin=110001&destinationPin=400001&articleType=parcel",
      headers: authHeader(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.serviceable).toBe(true);
    expect(body.data.degraded).toBe(true);
    expect(body.data.provider).toBe("DTDC");
  });
});
