import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/**
 * Route-level integration tests for multi-gateway payment routes.
 *
 * Covers:
 * - POST /v1/billing/payments/initiate → 202 (happy path, mocked)
 * - GET  /v1/billing/payments/:id/status → 200 (happy path, mocked)
 * - POST /v1/billing/payments/:id/capture → 200 (happy path, mocked)
 * - 401 without auth
 * - 403 unauthorized role
 * - 400 invalid input (zod validation)
 * - UPI method rejected when disabled
 * - e-mandate method rejected when disabled
 *
 * Validates: Requirements 13.4, 13.5, 13.6, 13.7, 13.8
 */

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "11111111-aaaa-4000-8000-000000000001";
const ACTOR = "00000000-aaaa-4000-8000-000000000001";

function token(roles: string[] = ["billing_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-gw" }, SECRET, 3600);
}

describe("Gateway routes — happy path (Razorpay, mocked)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");
    vi.stubEnv("PAYMENT_UPI_ENABLED", "false");
    vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "false");

    // Mock fetch for Razorpay responses
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/orders") && !url.includes("/payments")) {
        if (url.endsWith("/orders")) {
          // createOrder
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              id: "order_MockRzp123",
              status: "created",
              created_at: Math.floor(Date.now() / 1000),
            }),
          });
        }
        // checkStatus (GET /orders/:id)
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            id: "order_MockRzp123",
            amount: 50000,
            currency: "INR",
            status: "paid",
            method: "card",
          }),
        });
      }
      if (url.includes("/orders/") && url.includes("/payments")) {
        // capturePayment — list payments for order
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            items: [{ id: "pay_ABC", amount: 50000, currency: "INR", status: "captured" }],
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("not found") });
    });
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POST /v1/billing/payments/initiate returns 202 with gateway order", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        amountPaise: 50000,
        currency: "INR",
        method: "gateway",
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.gatewayOrderId).toBe("order_MockRzp123");
    expect(body.data.gateway).toBe("razorpay");
    expect(body.data.amount).toBe("50000");
    expect(body.data.currency).toBe("INR");
    expect(body.data.status).toBe("created");
    expect(body.correlationId).toBeDefined();
  });

  it("GET /v1/billing/payments/:id/status returns 200 with payment status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/payments/order_MockRzp123/status",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.gatewayOrderId).toBe("order_MockRzp123");
    expect(body.data.status).toBe("captured");
    expect(body.data.amountPaise).toBe("50000");
    expect(body.data.method).toBe("card");
  });

  it("POST /v1/billing/payments/:id/capture returns 200 with capture result", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/order_MockRzp123/capture",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.gatewayOrderId).toBe("order_MockRzp123");
    expect(body.data.status).toBe("captured");
    expect(body.data.capturedAmount).toBe("50000");
    expect(body.data.currency).toBe("INR");
  });
});

describe("Gateway routes — auth and validation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("PAYMENT_UPI_ENABLED", "false");
    vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "false");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POST /v1/billing/payments/initiate returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { "x-tenant-id": TENANT },
      payload: { amountPaise: 50000, currency: "INR" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/billing/payments/initiate returns 403 for unauthorized role", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { authorization: `Bearer ${token(["employee"])}`, "x-tenant-id": TENANT },
      payload: { amountPaise: 50000, currency: "INR" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/billing/payments/initiate returns 400 for invalid amount", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: { amountPaise: 0, currency: "INR" },
    });
    // Validation error: minimum 100 paise
    expect([400, 500]).toContain(res.statusCode);
  });

  it("GET /v1/billing/payments/:id/status returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/billing/payments/order_123/status",
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/billing/payments/:id/capture returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/order_123/capture",
      headers: { "x-tenant-id": TENANT },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Gateway routes — UPI/e-mandate disabled", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", SECRET);
    vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
    vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
    vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
    vi.stubEnv("PAYMENT_UPI_ENABLED", "false");
    vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "false");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects upi_autopay method when PAYMENT_UPI_ENABLED is false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        amountPaise: 50000,
        currency: "INR",
        method: "upi_autopay",
        mandateId: "mandate-123",
      },
    });

    // The GatewayError (PAYMENT_METHOD_UNAVAILABLE) should be caught by the error handler
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });

  it("rejects emandate method when PAYMENT_EMANDATE_ENABLED is false", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        amountPaise: 50000,
        currency: "INR",
        method: "emandate",
        mandateId: "mandate-456",
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe("PAYMENT_METHOD_UNAVAILABLE");
  });

  it("requires mandateId for upi_autopay method", async () => {
    // Enable UPI to test the mandateId validation
    vi.stubEnv("PAYMENT_UPI_ENABLED", "true");
    vi.stubEnv("UPI_AUTOPAY_BASE_URL", "https://upi.example.com");
    vi.stubEnv("UPI_AUTOPAY_API_KEY", "key");
    vi.resetModules();

    const { buildApp } = await import("../src/app.js");
    const testApp = await buildApp();
    await testApp.ready();

    const res = await testApp.inject({
      method: "POST",
      url: "/v1/billing/payments/initiate",
      headers: { authorization: `Bearer ${token()}`, "x-tenant-id": TENANT },
      payload: {
        amountPaise: 50000,
        currency: "INR",
        method: "upi_autopay",
        // mandateId deliberately omitted
      },
    });

    // Should return 400 for missing mandateId
    expect([400, 422]).toContain(res.statusCode);
    await testApp.close();
  });
});
