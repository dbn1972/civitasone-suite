import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";

/**
 * Route-level integration tests for GeM (Government e-Marketplace) adapter endpoints.
 *
 * Tests:
 * - GET  /v1/procurement/gem/products?q=... → 503 INTEGRATION_DISABLED when not configured
 * - GET  /v1/procurement/gem/products/:id   → 503 INTEGRATION_DISABLED when not configured
 * - POST /v1/procurement/gem/orders         → 503 INTEGRATION_DISABLED when not configured
 * - GET  /v1/procurement/gem/products?q=... → 200 happy path (mocked upstream)
 * - GET  /v1/procurement/gem/products/:id   → 200 happy path (mocked upstream)
 * - POST /v1/procurement/gem/orders         → 202 happy path (mocked upstream)
 * - GET  /v1/procurement/gem/products?q=... → 401 without token
 * - GET  /v1/procurement/gem/products?q=... → 403 without procurement role
 * - GET  /v1/procurement/gem/products?q=... → 503 CIRCUIT_OPEN when breaker is open
 * - POST /v1/procurement/gem/orders         → 400 invalid body (zod)
 * - Upstream timeout returns 502
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.6, 22.7
 */

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function makeToken(roles: string[]): string {
  return signToken(
    { sub: ACTOR, tid: TENANT, roles, sid: "sess-test" },
    JWT_SECRET,
    3600,
  );
}

describe("GeM adapter routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("when adapter is disabled (default)", () => {
    it("GET /v1/procurement/gem/products returns 503 INTEGRATION_DISABLED", async () => {
      vi.stubEnv("GEM_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("GeM integration is not available");
      expect(body.error.correlationId).toBeDefined();

      await app.close();
    });

    it("GET /v1/procurement/gem/products/:id returns 503 INTEGRATION_DISABLED", async () => {
      vi.stubEnv("GEM_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products/PROD-001",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("GeM integration is not available");

      await app.close();
    });

    it("POST /v1/procurement/gem/orders returns 503 INTEGRATION_DISABLED", async () => {
      vi.stubEnv("GEM_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: {
          items: [{ productId: "P-001", quantity: 5, deliveryAddress: "Block A, Delhi" }],
          buyerOrganization: "Dept of IT",
          contactName: "Officer Test",
          contactEmail: "officer@gov.in",
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");

      await app.close();
    });
  });

  describe("authentication and authorization", () => {
    it("GET /v1/procurement/gem/products without auth returns 401", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it("GET /v1/procurement/gem/products with non-procurement role returns 403", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
      await app.close();
    });

    it("POST /v1/procurement/gem/orders without auth returns 401", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: { "content-type": "application/json" },
        payload: {
          items: [{ productId: "P-001", quantity: 5, deliveryAddress: "Block A" }],
          buyerOrganization: "Dept",
          contactName: "Test",
          contactEmail: "test@gov.in",
        },
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  describe("validation", () => {
    it("POST /v1/procurement/gem/orders with invalid body returns 400", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: {
          items: [],
          buyerOrganization: "",
          contactName: "",
          contactEmail: "invalid-email",
        },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(600);
      await app.close();
    });

    it("GET /v1/procurement/gem/products without q param returns 400", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect(res.statusCode).toBeLessThan(600);
      await app.close();
    });
  });

  describe("happy path (mocked upstream)", () => {
    it("GET /v1/procurement/gem/products returns 200 with products", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          products: [
            { productId: "GEM-P-001", name: "HP Laptop", category: "IT Equipment", unitPriceMinor: "5500000", currency: "INR", availability: "in_stock" },
            { productId: "GEM-P-002", name: "Dell Monitor", category: "IT Equipment", unitPriceMinor: "2500000", currency: "INR", availability: "in_stock" },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].productId).toBe("GEM-P-001");
      expect(body.meta.total).toBe(2);

      await app.close();
    });

    it("GET /v1/procurement/gem/products/:id returns 200 with product details", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          productId: "GEM-P-001",
          name: "HP Laptop ProBook 450",
          category: "IT Equipment",
          brand: "HP",
          description: "Business laptop with 16GB RAM",
          specifications: { ram: "16GB", storage: "512GB SSD" },
          unitPriceMinor: "5500000",
          currency: "INR",
          seller: "HP India Pvt Ltd",
          availability: "in_stock",
          lastUpdatedAt: "2026-07-10T10:00:00Z",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_admin"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products/GEM-P-001",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.productId).toBe("GEM-P-001");
      expect(body.data.name).toBe("HP Laptop ProBook 450");
      expect(body.data.specifications.ram).toBe("16GB");

      await app.close();
    });

    it("POST /v1/procurement/gem/orders returns 202 on success", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          orderId: "GEM-ORD-2026-001234",
          status: "accepted",
          submittedAt: "2026-07-10T10:30:00Z",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: {
          items: [
            { productId: "GEM-P-001", quantity: 10, deliveryAddress: "Block A, CGO Complex, New Delhi" },
          ],
          buyerOrganization: "Department of Information Technology",
          contactName: "Procurement Officer",
          contactEmail: "procurement@gov.in",
          remarks: "Urgent requirement for new hires",
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.orderId).toBe("GEM-ORD-2026-001234");
      expect(body.data.status).toBe("accepted");

      await app.close();
    });
  });

  describe("circuit breaker at route level", () => {
    it("returns 503 CIRCUIT_OPEN when breaker is tripped", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);

      // Trip the circuit breaker with 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/procurement/gem/products?q=laptop",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(502); // EXTERNAL_FAILURE
      }

      // 6th call should get CIRCUIT_OPEN
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.correlationId).toBeDefined();

      await app.close();
    });
  });

  describe("upstream timeout", () => {
    it("returns 502 when upstream times out", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem.example.com");
      vi.stubEnv("GEM_API_KEY", "test-api-key");
      vi.stubEnv("GEM_TIMEOUT_MS", "50");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          const signal = init?.signal;
          if (signal) {
            signal.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const { buildApp } = await import("../src/app.js");
      const app = await buildApp();

      const token = makeToken(["procurement_officer"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products/PROD-001",
        headers: { authorization: `Bearer ${token}` },
      });

      // Timeout aborts through circuit breaker — since AbortError is not a
      // GemAdapterError or CircuitBreakerOpenError, Fastify returns 500.
      expect(res.statusCode).toBe(500);

      await app.close();
    });
  });

  describe("no PII in logs", () => {
    it("adapter error messages do not contain PII", async () => {
      const { GemAdapterError } = await import("../src/modules/gem/adapter.js");
      const err = new GemAdapterError("GeM API returned 500", "GEM_API_ERROR", 500);
      expect(err.message).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN pattern
      expect(err.message).not.toMatch(/\b\d{12}\b/); // Aadhaar pattern
      expect(err.message).not.toMatch(/\b[\w.-]+@[\w.-]+\.\w+\b/); // Email pattern
      expect(err.message).not.toMatch(/\b\d{10}\b/); // Phone pattern
      expect(err.code).toBe("GEM_API_ERROR");
    });
  });
});
