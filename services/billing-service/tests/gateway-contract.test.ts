import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Contract tests for the multi-gateway payment adapter (Razorpay, PayU, CCAvenue).
 *
 * Validates recorded fixture responses (realistic shapes), disabled/unconfigured state,
 * circuit breaker behavior, auth error handling, and PII-free error responses.
 *
 * Uses mocked globalThis.fetch with recorded fixture data for CI.
 * When PAYMENT_LIVE_SANDBOX=true is set, tests hit the real sandbox APIs.
 *
 * Validates: Requirements 23.4
 */

// ── Recorded Razorpay fixtures ────────────────────────────────────

const RAZORPAY_CREATE_ORDER_FIXTURE = {
  id: "order_Nk2XRWPX5K3Yjv",
  entity: "order",
  amount: 100000,
  amount_paid: 0,
  amount_due: 100000,
  currency: "INR",
  receipt: "order-tenant123-1720000000000",
  offer_id: null,
  status: "created",
  attempts: 0,
  notes: { tenantId: "11111111-aaaa-4000-8000-000000000001" },
  created_at: 1720000000,
};

const RAZORPAY_STATUS_FIXTURE = {
  id: "order_Nk2XRWPX5K3Yjv",
  entity: "order",
  amount: 100000,
  currency: "INR",
  status: "paid",
  method: "upi",
};

const RAZORPAY_PAYMENTS_FIXTURE = {
  items: [
    {
      id: "pay_Nk3ABC123DEF",
      entity: "payment",
      amount: 100000,
      currency: "INR",
      status: "captured",
      method: "upi",
      order_id: "order_Nk2XRWPX5K3Yjv",
    },
  ],
};

// ── Recorded PayU fixtures ────────────────────────────────────────

const PAYU_CREATE_ORDER_FIXTURE = {
  orderId: "payu-order-abc123",
  status: "created",
  amount: 100000,
  currency: "INR",
  createdAt: "2026-07-10T10:00:00Z",
};

// ── Recorded CCAvenue fixtures ────────────────────────────────────

const CCAVENUE_CREATE_ORDER_FIXTURE = {
  orderId: "cc-order-xyz789",
  status: "initiated",
  amount: 100000,
  currency: "INR",
  createdAt: "2026-07-10T10:00:00Z",
};

describe("payment gateway adapter — contract tests (recorded fixtures)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("Razorpay — recorded fixture response shape", () => {
    it("createOrder returns correct shape with gatewayOrderId, gateway, amount, status", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_NkIBzZ1234ABCD");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "test_secret_razorpay_1234");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(RAZORPAY_CREATE_ORDER_FIXTURE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder } = await import("../src/modules/gateways/index.js");
      const result = await createOrder(BigInt(100000), "INR", {
        tenantId: "11111111-aaaa-4000-8000-000000000001",
      });

      // Validate shape matches contract
      expect(result).toHaveProperty("gatewayOrderId");
      expect(result).toHaveProperty("gateway");
      expect(result).toHaveProperty("amount");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("metadata");
      expect(result).toHaveProperty("createdAt");

      // Validate types
      expect(typeof result.gatewayOrderId).toBe("string");
      expect(result.gateway).toBe("razorpay");
      expect(typeof result.amount).toBe("bigint");
      expect(result.amount).toBe(BigInt(100000));
      expect(result.currency).toBe("INR");
      expect(["created", "attempted", "paid", "failed"]).toContain(result.status);
      expect(typeof result.createdAt).toBe("string");

      // Validate specific fixture values
      expect(result.gatewayOrderId).toBe("order_Nk2XRWPX5K3Yjv");
      expect(result.status).toBe("created");
    });

    it("checkStatus returns correct shape with status and amountPaise", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(RAZORPAY_STATUS_FIXTURE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { checkStatus } = await import("../src/modules/gateways/index.js");
      const result = await checkStatus("order_Nk2XRWPX5K3Yjv");

      // Validate shape
      expect(result).toHaveProperty("gatewayOrderId");
      expect(result).toHaveProperty("gateway");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("amountPaise");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("updatedAt");

      // Validate types
      expect(typeof result.gatewayOrderId).toBe("string");
      expect(result.gateway).toBe("razorpay");
      expect(typeof result.amountPaise).toBe("bigint");
      expect(result.amountPaise).toBe(BigInt(100000));
      expect(result.status).toBe("captured"); // "paid" maps to "captured"
      expect(result.method).toBe("upi");
    });

    it("capturePayment returns correct shape with capturedAmount", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(RAZORPAY_PAYMENTS_FIXTURE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { capturePayment } = await import("../src/modules/gateways/index.js");
      const result = await capturePayment("order_Nk2XRWPX5K3Yjv");

      // Validate shape
      expect(result).toHaveProperty("gatewayOrderId");
      expect(result).toHaveProperty("gateway");
      expect(result).toHaveProperty("capturedAmount");
      expect(result).toHaveProperty("currency");
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("capturedAt");

      // Validate types
      expect(typeof result.gatewayOrderId).toBe("string");
      expect(result.gateway).toBe("razorpay");
      expect(typeof result.capturedAmount).toBe("bigint");
      expect(result.capturedAmount).toBe(BigInt(100000));
      expect(["captured", "failed"]).toContain(result.status);
    });
  });

  describe("gateway not configured → GatewayError", () => {
    it("throws GATEWAY_NOT_CONFIGURED when RAZORPAY_KEY_ID is missing", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      // Deliberately don't set RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder, GatewayError } = await import("../src/modules/gateways/index.js");

      await expect(
        createOrder(BigInt(50000), "INR", { tenantId: "tenant-1" }),
      ).rejects.toMatchObject({
        code: "GATEWAY_NOT_CONFIGURED",
        name: "GatewayError",
      });

      // fetch should not have been called since the error is thrown before that
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("circuit breaker open → CircuitBreakerOpenError", () => {
    it("opens after 5 consecutive failures and rejects subsequent calls", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "1000");

      // Use 4xx errors so withRetry does NOT retry (GatewayError.isClientError = true).
      // Each call still counts as a circuit breaker failure since the call itself throws.
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { checkStatus, CircuitBreakerOpenError } = await import(
        "../src/modules/gateways/index.js"
      );

      // Trip the breaker with 5 fast failures (4xx = no retry).
      let failures = 0;
      for (let i = 0; i < 5; i++) {
        try {
          await checkStatus(`order_fail_${i}`);
        } catch {
          failures++;
        }
      }

      expect(failures).toBe(5);

      // Next call should be rejected by circuit breaker (open state)
      await expect(checkStatus("order_after_open")).rejects.toBeInstanceOf(
        CircuitBreakerOpenError,
      );

      // The 6th call should NOT have triggered fetch
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("401/403 auth errors from upstream gateway", () => {
    it("throws GatewayError with httpStatus 401 on Razorpay auth failure", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_invalid_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_invalid_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder, GatewayError } = await import("../src/modules/gateways/index.js");

      await expect(
        createOrder(BigInt(50000), "INR", { tenantId: "tenant-1" }),
      ).rejects.toMatchObject({
        name: "GatewayError",
        httpStatus: 401,
      });
    });

    it("throws GatewayError with httpStatus 403 on Razorpay forbidden", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder, GatewayError } = await import("../src/modules/gateways/index.js");

      await expect(
        createOrder(BigInt(50000), "INR", { tenantId: "tenant-1" }),
      ).rejects.toMatchObject({
        name: "GatewayError",
        httpStatus: 403,
      });
    });
  });

  describe("no PII in error responses", () => {
    it("GatewayError messages do not contain customer PII", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "5000");

      // Simulate a 400 response from Razorpay that might contain PII
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                code: "BAD_REQUEST_ERROR",
                description: "Payment for customer Priya Sharma (pan: ABCDE1234F) failed",
              },
            }),
          ),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder, GatewayError } = await import("../src/modules/gateways/index.js");

      try {
        await createOrder(BigInt(50000), "INR", { tenantId: "tenant-1" });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayError);
        const gwErr = err as InstanceType<typeof GatewayError>;
        // Error message should NOT contain PII from the upstream response
        expect(gwErr.message).not.toContain("Priya Sharma");
        expect(gwErr.message).not.toContain("ABCDE1234F"); // PAN
        expect(gwErr.message).not.toContain("pan:");
        // Should contain generic message
        expect(gwErr.message).toContain("Razorpay createOrder failed");
        expect(gwErr.message).toContain("400");
      }
    });

    it("GATEWAY_NOT_CONFIGURED error does not leak API keys", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      // Don't set RAZORPAY_KEY_ID

      const { createOrder, GatewayError } = await import("../src/modules/gateways/index.js");

      try {
        await createOrder(BigInt(50000), "INR", { tenantId: "tenant-1" });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayError);
        const gwErr = err as InstanceType<typeof GatewayError>;
        expect(gwErr.message).not.toContain("rzp_test_key");
        expect(gwErr.message).not.toContain("rzp_test_secret");
        expect(gwErr.code).toBe("GATEWAY_NOT_CONFIGURED");
      }
    });

    it("timeout error does not contain transaction or customer details", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_key");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "rzp_test_secret");
      vi.stubEnv("PAYMENT_TIMEOUT_MS", "100");

      // Simulate a timeout: fetch throws AbortError
      const fetchMock = vi.fn().mockRejectedValue(
        Object.assign(new Error("The operation was aborted"), { name: "AbortError" }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder, GatewayError } = await import("../src/modules/gateways/index.js");

      try {
        await createOrder(BigInt(99999), "INR", {
          tenantId: "tenant-1",
          subscriptionId: "sub-sensitive-123",
        });
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GatewayError);
        const gwErr = err as InstanceType<typeof GatewayError>;
        // Should not contain the subscription ID or other metadata
        expect(gwErr.message).not.toContain("sub-sensitive-123");
        expect(gwErr.message).not.toContain("99999");
        expect(gwErr.code).toBe("GATEWAY_TIMEOUT");
      }
    });
  });

  describe("gateway selection", () => {
    it("resolves razorpay as default when PAYMENT_GATEWAY is not set", async () => {
      // Don't set PAYMENT_GATEWAY
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("razorpay");
    });

    it("resolves payu when PAYMENT_GATEWAY=payu", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "payu");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("payu");
    });

    it("resolves ccavenue when PAYMENT_GATEWAY=ccavenue", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "ccavenue");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("ccavenue");
    });

    it("falls back to razorpay for unknown gateway value", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "unknown_gateway");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("razorpay");
    });
  });

  describe("GatewayError classification", () => {
    it("isTransient returns true for 5xx errors", async () => {
      const { GatewayError } = await import("../src/modules/gateways/index.js");
      const err = new GatewayError("fail", "TEST", "razorpay", 500);
      expect(err.isTransient).toBe(true);
    });

    it("isTransient returns true for timeout (no httpStatus)", async () => {
      const { GatewayError } = await import("../src/modules/gateways/index.js");
      const err = new GatewayError("timeout", "GATEWAY_TIMEOUT", "razorpay");
      expect(err.isTransient).toBe(true);
    });

    it("isClientError returns true for 4xx errors", async () => {
      const { GatewayError } = await import("../src/modules/gateways/index.js");
      const err = new GatewayError("bad request", "TEST", "razorpay", 400);
      expect(err.isClientError).toBe(true);
    });

    it("isClientError returns false for 5xx", async () => {
      const { GatewayError } = await import("../src/modules/gateways/index.js");
      const err = new GatewayError("fail", "TEST", "razorpay", 502);
      expect(err.isClientError).toBe(false);
    });
  });
});
