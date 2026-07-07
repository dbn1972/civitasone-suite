import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the multi-gateway payment adapter module.
 *
 * Covers:
 * - Gateway selection by PAYMENT_GATEWAY env
 * - Circuit breaker (5 failures → 30s open)
 * - Retry logic (1s/2s/4s for 5xx, no retry on 4xx)
 * - UPI-autopay and e-mandate env gate
 * - Happy path (mocked responses)
 *
 * Validates: Requirements 13.4, 13.5, 13.6, 13.7, 13.8
 */

describe("Multi-gateway payment adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("gateway selection via PAYMENT_GATEWAY env", () => {
    it("selects razorpay when PAYMENT_GATEWAY=razorpay", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("razorpay");
    });

    it("selects payu when PAYMENT_GATEWAY=payu", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "payu");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("payu");
    });

    it("selects ccavenue when PAYMENT_GATEWAY=ccavenue", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "ccavenue");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("ccavenue");
    });

    it("defaults to razorpay when PAYMENT_GATEWAY is unset", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("razorpay");
    });

    it("defaults to razorpay for unknown gateway value", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "unknown_gw");
      const { getConfiguredGateway } = await import("../src/modules/gateways/index.js");
      expect(getConfiguredGateway()).toBe("razorpay");
    });

    it("resolveGateway returns adapter matching env", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "payu");
      const { resolveGateway } = await import("../src/modules/gateways/index.js");
      const gw = resolveGateway();
      expect(gw.name).toBe("payu");
    });

    it("resolveGateway with explicit name overrides env", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      const { resolveGateway } = await import("../src/modules/gateways/index.js");
      const gw = resolveGateway("ccavenue");
      expect(gw.name).toBe("ccavenue");
    });
  });

  describe("circuit breaker", () => {
    it("opens after 5 consecutive failures and rejects subsequent calls", async () => {
      const { CircuitBreaker, CircuitBreakerOpenError } = await import("@civitasone/circuit-breaker");

      // Test the circuit breaker directly (no retry delay)
      const breaker = new CircuitBreaker({
        name: "test-payment-gw",
        failureThreshold: 5,
        recoveryMs: 30_000,
      });

      // Simulate 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        await expect(
          breaker.call(() => Promise.reject(new Error("server error"))),
        ).rejects.toThrow("server error");
      }

      // After 5 failures, breaker should be open
      expect(breaker.state).toBe("open");

      // Next call should be rejected immediately without executing fn
      await expect(
        breaker.call(() => Promise.resolve("should not execute")),
      ).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    });

    it("resets to closed after a successful probe in half-open state", async () => {
      const { CircuitBreaker } = await import("@civitasone/circuit-breaker");

      const breaker = new CircuitBreaker({
        name: "test-payment-gw-recovery",
        failureThreshold: 5,
        recoveryMs: 50, // short recovery for testing
      });

      // Trip the breaker
      for (let i = 0; i < 5; i++) {
        await breaker.call(() => Promise.reject(new Error("fail"))).catch(() => {});
      }
      expect(breaker.state).toBe("open");

      // Wait for recovery window
      await new Promise((r) => setTimeout(r, 60));

      // Should now be half-open, next success closes it
      expect(breaker.state).toBe("half-open");
      const result = await breaker.call(() => Promise.resolve("recovered"));
      expect(result).toBe("recovered");
      expect(breaker.state).toBe("closed");
    });
  });

  describe("retry logic", () => {
    it("retries on 5xx with exponential backoff (1s/2s/4s)", async () => {
      const { withRetry } = await import("../src/modules/gateways/retry.js");
      const { GatewayError } = await import("../src/modules/gateways/types.js");

      let attempts = 0;
      const fn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.reject(new GatewayError("server error", "SERVER_ERROR", "razorpay", 500));
        }
        return Promise.resolve("success");
      });

      // Use short delays to keep tests fast
      const result = await withRetry(fn, { backoffMs: [1, 1, 1] });

      expect(result).toBe("success");
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("does NOT retry on 4xx errors", async () => {
      const { withRetry } = await import("../src/modules/gateways/retry.js");
      const { GatewayError } = await import("../src/modules/gateways/types.js");

      const fn = vi.fn().mockRejectedValue(
        new GatewayError("bad request", "CLIENT_ERROR", "razorpay", 400),
      );

      await expect(withRetry(fn, { backoffMs: [10, 20, 40] })).rejects.toMatchObject({
        code: "CLIENT_ERROR",
        httpStatus: 400,
      });

      // Should only be called once (no retries)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry on 422 errors", async () => {
      const { withRetry } = await import("../src/modules/gateways/retry.js");
      const { GatewayError } = await import("../src/modules/gateways/types.js");

      const fn = vi.fn().mockRejectedValue(
        new GatewayError("unprocessable", "VALIDATION_ERROR", "payu", 422),
      );

      await expect(withRetry(fn, { backoffMs: [10, 20, 40] })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        httpStatus: 422,
      });

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("exhausts retries and throws last error on persistent 5xx", async () => {
      const { withRetry } = await import("../src/modules/gateways/retry.js");
      const { GatewayError } = await import("../src/modules/gateways/types.js");

      const fn = vi.fn().mockRejectedValue(
        new GatewayError("server error", "SERVER_ERROR", "ccavenue", 503),
      );

      // Use short real delays to avoid fake timer complexities
      await expect(withRetry(fn, { backoffMs: [1, 1, 1] })).rejects.toMatchObject({
        code: "SERVER_ERROR",
        httpStatus: 503,
      });

      expect(fn).toHaveBeenCalledTimes(3);
    });

    it("retries on timeout (no httpStatus)", async () => {
      const { withRetry } = await import("../src/modules/gateways/retry.js");
      const { GatewayError } = await import("../src/modules/gateways/types.js");

      let attempts = 0;
      const fn = vi.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 2) {
          return Promise.reject(new GatewayError("timeout", "GATEWAY_TIMEOUT", "razorpay"));
        }
        return Promise.resolve("ok");
      });

      const result = await withRetry(fn, { backoffMs: [1, 1, 1] });

      expect(result).toBe("ok");
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("UPI-autopay gate", () => {
    it("rejects when PAYMENT_UPI_ENABLED is not true", async () => {
      vi.stubEnv("PAYMENT_UPI_ENABLED", "false");

      const { registerUpiMandate } = await import("../src/modules/gateways/upi-autopay.js");

      await expect(registerUpiMandate({
        vpa: "test@upi",
        maxAmountPaise: 100000n,
        frequency: "monthly",
        tenantId: "tenant-1",
      })).rejects.toMatchObject({
        code: "PAYMENT_METHOD_UNAVAILABLE",
        message: "UPI-autopay payment method is unavailable",
      });
    });

    it("rejects when PAYMENT_UPI_ENABLED is unset", async () => {
      vi.stubEnv("PAYMENT_UPI_ENABLED", "");

      const { executeUpiPayment } = await import("../src/modules/gateways/upi-autopay.js");

      await expect(executeUpiPayment({
        mandateId: "mandate-1",
        amountPaise: 50000n,
        tenantId: "tenant-1",
      })).rejects.toMatchObject({
        code: "PAYMENT_METHOD_UNAVAILABLE",
      });
    });

    it("allows UPI calls when PAYMENT_UPI_ENABLED=true", async () => {
      vi.stubEnv("PAYMENT_UPI_ENABLED", "true");
      vi.stubEnv("UPI_AUTOPAY_BASE_URL", "https://upi.example.com");
      vi.stubEnv("UPI_AUTOPAY_API_KEY", "upi-test-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          mandateId: "m-123",
          status: "created",
          createdAt: "2026-07-10T10:00:00Z",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { registerUpiMandate } = await import("../src/modules/gateways/upi-autopay.js");
      const result = await registerUpiMandate({
        vpa: "test@upi",
        maxAmountPaise: 100000n,
        frequency: "monthly",
        tenantId: "tenant-1",
      });

      expect(result.mandateId).toBe("m-123");
      expect(result.status).toBe("created");
    });

    it("isUpiEnabled returns false when disabled", async () => {
      vi.stubEnv("PAYMENT_UPI_ENABLED", "false");
      const { isUpiEnabled } = await import("../src/modules/gateways/upi-autopay.js");
      expect(isUpiEnabled()).toBe(false);
    });
  });

  describe("e-mandate gate", () => {
    it("rejects when PAYMENT_EMANDATE_ENABLED is not true", async () => {
      vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "false");

      const { registerEmandate } = await import("../src/modules/gateways/upi-autopay.js");

      await expect(registerEmandate({
        accountNumber: "1234567890",
        ifsc: "HDFC0001234",
        maxAmountPaise: 500000n,
        frequency: "monthly",
        tenantId: "tenant-1",
      })).rejects.toMatchObject({
        code: "PAYMENT_METHOD_UNAVAILABLE",
        message: "e-mandate payment method is unavailable",
      });
    });

    it("allows e-mandate calls when PAYMENT_EMANDATE_ENABLED=true", async () => {
      vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "true");
      vi.stubEnv("EMANDATE_BASE_URL", "https://emandate.example.com");
      vi.stubEnv("EMANDATE_API_KEY", "emandate-test-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          mandateId: "em-456",
          status: "pending",
          createdAt: "2026-07-10T10:00:00Z",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { registerEmandate } = await import("../src/modules/gateways/upi-autopay.js");
      const result = await registerEmandate({
        accountNumber: "1234567890",
        ifsc: "HDFC0001234",
        maxAmountPaise: 500000n,
        frequency: "monthly",
        tenantId: "tenant-1",
      });

      expect(result.mandateId).toBe("em-456");
      expect(result.status).toBe("pending");
    });

    it("isEmandateEnabled returns false when disabled", async () => {
      vi.stubEnv("PAYMENT_EMANDATE_ENABLED", "false");
      const { isEmandateEnabled } = await import("../src/modules/gateways/upi-autopay.js");
      expect(isEmandateEnabled()).toBe(false);
    });
  });

  describe("happy path — Razorpay createOrder (mocked)", () => {
    it("creates order successfully via Razorpay adapter", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_123");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "secret_test_456");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: "order_ABC123",
          status: "created",
          created_at: Math.floor(Date.now() / 1000),
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder } = await import("../src/modules/gateways/index.js");
      const result = await createOrder(50000n, "INR", { tenantId: "tenant-1" });

      expect(result.gatewayOrderId).toBe("order_ABC123");
      expect(result.gateway).toBe("razorpay");
      expect(result.amount).toBe(50000n);
      expect(result.currency).toBe("INR");
      expect(result.status).toBe("created");
    });
  });

  describe("happy path — Razorpay checkStatus (mocked)", () => {
    it("returns payment status from Razorpay", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "razorpay");
      vi.stubEnv("RAZORPAY_KEY_ID", "rzp_test_123");
      vi.stubEnv("RAZORPAY_KEY_SECRET", "secret_test_456");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: "order_ABC123",
          amount: 50000,
          currency: "INR",
          status: "paid",
          method: "card",
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { checkStatus } = await import("../src/modules/gateways/index.js");
      const result = await checkStatus("order_ABC123");

      expect(result.gatewayOrderId).toBe("order_ABC123");
      expect(result.status).toBe("captured");
      expect(result.amountPaise).toBe(50000n);
      expect(result.method).toBe("card");
    });
  });

  describe("happy path — PayU createOrder (mocked)", () => {
    it("creates order successfully via PayU adapter", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "payu");
      vi.stubEnv("PAYU_MERCHANT_KEY", "test_merchant");
      vi.stubEnv("PAYU_SALT", "test_salt_value");
      vi.stubEnv("PAYU_BASE_URL", "https://payu-sandbox.example.com");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder } = await import("../src/modules/gateways/index.js");
      const result = await createOrder(100000n, "INR", { tenantId: "tenant-2" });

      expect(result.gateway).toBe("payu");
      expect(result.amount).toBe(100000n);
      expect(result.status).toBe("created");
      expect(result.gatewayOrderId).toContain("payu-tenant-2-");
    });
  });

  describe("happy path — CCAvenue createOrder (mocked)", () => {
    it("creates order successfully via CCAvenue adapter", async () => {
      vi.stubEnv("PAYMENT_GATEWAY", "ccavenue");
      vi.stubEnv("CCAVENUE_MERCHANT_ID", "123456");
      vi.stubEnv("CCAVENUE_ACCESS_CODE", "ABCD1234");
      vi.stubEnv("CCAVENUE_WORKING_KEY", "test_working_key_32chars!");
      vi.stubEnv("CCAVENUE_BASE_URL", "https://ccavenue-sandbox.example.com");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(""),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { createOrder } = await import("../src/modules/gateways/index.js");
      const result = await createOrder(75000n, "INR", { tenantId: "tenant-3" });

      expect(result.gateway).toBe("ccavenue");
      expect(result.amount).toBe(75000n);
      expect(result.status).toBe("created");
      expect(result.gatewayOrderId).toContain("cca-tenant-3-");
    });
  });

  describe("GatewayError classification", () => {
    it("isTransient=true for 5xx errors", async () => {
      const { GatewayError } = await import("../src/modules/gateways/types.js");
      const err = new GatewayError("server error", "ERR", "razorpay", 502);
      expect(err.isTransient).toBe(true);
      expect(err.isClientError).toBe(false);
    });

    it("isClientError=true for 4xx errors", async () => {
      const { GatewayError } = await import("../src/modules/gateways/types.js");
      const err = new GatewayError("bad request", "ERR", "payu", 400);
      expect(err.isClientError).toBe(true);
      expect(err.isTransient).toBe(false);
    });

    it("isTransient=true for timeout (no httpStatus)", async () => {
      const { GatewayError } = await import("../src/modules/gateways/types.js");
      const err = new GatewayError("timeout", "TIMEOUT", "ccavenue");
      expect(err.isTransient).toBe(true);
      expect(err.isClientError).toBe(false);
    });
  });
});
