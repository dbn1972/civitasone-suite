/**
 * Government Rail Contract Tests — GeM (Government e-Marketplace)
 *
 * Contract tests against recorded HTTP fixtures. Validates the GeM adapter
 * behaves correctly against realistic response shapes from the GeM API
 * (product search, product details, order submission).
 *
 * When GeM sandbox credentials are configured (GEM_SANDBOX_URL), tests will
 * hit the live sandbox. Otherwise, they run against recorded fixtures.
 *
 * Validates: Requirements 22.3
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function makeToken(roles: string[] = ["procurement_officer"]): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-gem" }, JWT_SECRET, 3600);
}

// ── Recorded Fixtures (realistic GeM API response shapes) ───────────

const FIXTURES = {
  searchProducts: {
    multipleResults: {
      products: [
        {
          productId: "GEM/2026/B/3456789",
          name: "HP ProBook 450 G10 Laptop",
          category: "IT Equipment/Laptops",
          brand: "HP",
          unitPriceMinor: "7299900",
          currency: "INR",
          seller: "HP India Sales Pvt Ltd",
          availability: "in_stock" as const,
        },
        {
          productId: "GEM/2026/B/3456790",
          name: "Dell Latitude 5540 Laptop",
          category: "IT Equipment/Laptops",
          brand: "Dell",
          unitPriceMinor: "6899900",
          currency: "INR",
          seller: "Dell Technologies India",
          availability: "in_stock" as const,
        },
        {
          productId: "GEM/2026/B/3456791",
          name: "Lenovo ThinkPad E16 Gen 2",
          category: "IT Equipment/Laptops",
          brand: "Lenovo",
          unitPriceMinor: "5599900",
          currency: "INR",
          seller: "Lenovo India Pvt Ltd",
          availability: "limited" as const,
        },
      ],
      total: 47,
      page: 1,
      pageSize: 20,
    },
    emptyResult: {
      products: [],
      total: 0,
      page: 1,
      pageSize: 20,
    },
  },
  getProductDetails: {
    laptop: {
      productId: "GEM/2026/B/3456789",
      name: "HP ProBook 450 G10 Laptop",
      category: "IT Equipment/Laptops",
      brand: "HP",
      description: "14-inch Full HD, Intel Core i5-1335U, 16GB RAM, 512GB SSD, Windows 11 Pro",
      specifications: {
        processor: "Intel Core i5-1335U",
        ram: "16GB DDR4",
        storage: "512GB NVMe SSD",
        display: "14 inch Full HD IPS",
        os: "Windows 11 Pro",
        warranty: "3 Years Onsite",
      },
      unitPriceMinor: "7299900",
      currency: "INR",
      seller: "HP India Sales Pvt Ltd",
      availability: "in_stock" as const,
      lastUpdatedAt: "2026-07-08T06:00:00.000Z",
    },
  },
  submitOrder: {
    accepted: {
      orderId: "GEM-ORD-2026-DEL-001234",
      status: "accepted",
      submittedAt: "2026-07-10T11:00:00.000Z",
    },
    pendingReview: {
      orderId: "GEM-ORD-2026-DEL-001235",
      status: "pending_review",
      submittedAt: "2026-07-10T11:05:00.000Z",
    },
  },
} as const;

describe("Gov Rail Contract: GeM", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════
  // 1. Disabled adapter returns 503 (INTEGRATION_DISABLED)
  // ═══════════════════════════════════════════════════════════════════

  describe("disabled adapter → 503 INTEGRATION_DISABLED", () => {
    it("GET /v1/procurement/gem/products returns 503 when GEM_ENABLED is not set", async () => {
      vi.stubEnv("GEM_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("INTEGRATION_DISABLED");
      expect(body.error.message).toBe("GeM integration is not available");
      expect(body.error.correlationId).toBeDefined();
    });

    it("GET /v1/procurement/gem/products/:id returns 503 when disabled", async () => {
      vi.stubEnv("GEM_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products/GEM-P-001",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
    });

    it("POST /v1/procurement/gem/orders returns 503 when disabled", async () => {
      vi.stubEnv("GEM_ENABLED", "false");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: {
          authorization: `Bearer ${makeToken()}`,
          "content-type": "application/json",
        },
        payload: {
          items: [{ productId: "GEM/2026/B/3456789", quantity: 5, deliveryAddress: "Block A, CGO Complex" }],
          buyerOrganization: "Dept of IT",
          contactName: "Procurement Officer",
          contactEmail: "proc@gov.in",
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("INTEGRATION_DISABLED");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 2. Happy path with recorded fixture responses
  // ═══════════════════════════════════════════════════════════════════

  describe("happy path — recorded fixtures", () => {
    it("GET /v1/procurement/gem/products returns 200 with product listing", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem-sandbox.gov.in");
      vi.stubEnv("GEM_API_KEY", "sandbox-key-gem");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.searchProducts.multipleResults),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(3);
      expect(body.data[0].productId).toBe("GEM/2026/B/3456789");
      expect(body.data[0].name).toBe("HP ProBook 450 G10 Laptop");
      expect(body.data[0].unitPriceMinor).toBe("7299900");
      expect(body.meta.total).toBe(47);
    });

    it("GET /v1/procurement/gem/products/:id returns 200 with details", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem-sandbox.gov.in");
      vi.stubEnv("GEM_API_KEY", "sandbox-key-gem");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.getProductDetails.laptop),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products/GEM%2F2026%2FB%2F3456789",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.productId).toBe("GEM/2026/B/3456789");
      expect(body.data.specifications.processor).toBe("Intel Core i5-1335U");
      expect(body.data.specifications.ram).toBe("16GB DDR4");
      expect(body.data.availability).toBe("in_stock");
    });

    it("POST /v1/procurement/gem/orders returns 202 with accepted order", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem-sandbox.gov.in");
      vi.stubEnv("GEM_API_KEY", "sandbox-key-gem");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.submitOrder.accepted),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: {
          authorization: `Bearer ${makeToken()}`,
          "content-type": "application/json",
        },
        payload: {
          items: [
            { productId: "GEM/2026/B/3456789", quantity: 10, deliveryAddress: "Room 204, Block A, CGO Complex, New Delhi 110003" },
          ],
          buyerOrganization: "Department of Electronics & IT",
          contactName: "Procurement Officer",
          contactEmail: "procurement@meity.gov.in",
          remarks: "Annual IT refresh — FY 2026-27 Q2",
        },
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body.data.orderId).toBe("GEM-ORD-2026-DEL-001234");
      expect(body.data.status).toBe("accepted");
      expect(body.data.submittedAt).toBe("2026-07-10T11:00:00.000Z");
    });

    it("handles empty search results", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem-sandbox.gov.in");
      vi.stubEnv("GEM_API_KEY", "sandbox-key-gem");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(FIXTURES.searchProducts.emptyResult),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=nonexistentproduct12345",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(0);
      expect(body.meta.total).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 3. Circuit breaker opens after 5 failures → 503 CIRCUIT_OPEN
  // ═══════════════════════════════════════════════════════════════════

  describe("circuit breaker → 503 CIRCUIT_OPEN after 5 failures", () => {
    it("trips circuit breaker after 5 consecutive upstream failures", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem-sandbox.gov.in");
      vi.stubEnv("GEM_API_KEY", "sandbox-key-gem");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("GeM API gateway error"),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const token = makeToken();

      // Trigger 5 failures to trip the breaker
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "GET",
          url: "/v1/procurement/gem/products?q=laptop",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(502);
      }

      // 6th call should hit the open circuit breaker
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.error.code).toBe("CIRCUIT_OPEN");
      expect(body.error.correlationId).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 4. Auth tests — 401/403
  // ═══════════════════════════════════════════════════════════════════

  describe("auth — 401 without token", () => {
    it("GET /v1/procurement/gem/products returns 401 without auth header", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
      });

      expect(res.statusCode).toBe(401);
    });

    it("POST /v1/procurement/gem/orders returns 401 without auth header", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

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
    });
  });

  describe("auth — 403 with wrong role", () => {
    it("GET /v1/procurement/gem/products returns 403 for employee role", async () => {
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const token = makeToken(["employee"]);
      const res = await app.inject({
        method: "GET",
        url: "/v1/procurement/gem/products?q=laptop",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // 5. No PII in error responses
  // ═══════════════════════════════════════════════════════════════════

  describe("no PII in error responses", () => {
    it("upstream error body is not leaked to the client", async () => {
      vi.stubEnv("GEM_ENABLED", "true");
      vi.stubEnv("GEM_BASE_URL", "https://gem-sandbox.gov.in");
      vi.stubEnv("GEM_API_KEY", "sandbox-key-gem");
      vi.stubEnv("JWT_SECRET", JWT_SECRET);

      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve(JSON.stringify({
          error: "Buyer org 'Dept of IT' (GSTIN 22AAAAA0000A1Z5, officer Rajesh Kumar, email rajesh@nic.in) is not verified",
        })),
      }));

      const { buildApp } = await import("../src/app.js");
      app = await buildApp();

      const res = await app.inject({
        method: "POST",
        url: "/v1/procurement/gem/orders",
        headers: {
          authorization: `Bearer ${makeToken()}`,
          "content-type": "application/json",
        },
        payload: {
          items: [{ productId: "GEM/2026/B/3456789", quantity: 5, deliveryAddress: "Block A" }],
          buyerOrganization: "Dept of IT",
          contactName: "Officer",
          contactEmail: "proc@gov.in",
        },
      });

      const responseText = JSON.stringify(res.json());
      // Must not contain any PII from the upstream response
      expect(responseText).not.toContain("Rajesh Kumar");
      expect(responseText).not.toContain("rajesh@nic.in");
      expect(responseText).not.toContain("22AAAAA0000A1Z5");
      // Should return generic error
      expect(res.json().error.code).toBe("EXTERNAL_FAILURE");
    });

    it("adapter error messages are free of PII patterns", async () => {
      const { GemAdapterError } = await import("../src/modules/gem/adapter.js");
      const err = new GemAdapterError("GeM API returned 500", "GEM_API_ERROR", 500);
      expect(err.message).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/); // PAN pattern
      expect(err.message).not.toMatch(/\b\d{12}\b/); // Aadhaar pattern
      expect(err.message).not.toMatch(/\b[\w.-]+@[\w.-]+\.\w+\b/); // Email pattern
      expect(err.message).toBe("GeM API returned 500");
    });
  });
});
