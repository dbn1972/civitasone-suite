import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the NACH/APBS adapter module.
 *
 * Covers:
 * - Disabled adapter returns INTEGRATION_DISABLED error (fail-closed)
 * - Happy path mandate submission (mocked)
 * - Happy path mandate status check (mocked)
 * - Happy path bulk payment submission (mocked)
 * - Circuit breaker opens after 5 consecutive failures
 * - Timeout handling (15s default)
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.6, 22.7
 */

describe("NACH/APBS adapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("fail-closed when unconfigured", () => {
    it("throws INTEGRATION_DISABLED when NACH_ENABLED is not 'true'", async () => {
      vi.stubEnv("NACH_ENABLED", "false");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-key");

      const { submitMandate } = await import(
        "../src/modules/nach/adapter.js"
      );

      await expect(
        submitMandate({
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: 5000000n,
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        }),
      ).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
        message: "NACH/APBS integration is not available",
      });
    });

    it("throws INTEGRATION_DISABLED when NACH_ENABLED is missing", async () => {
      vi.stubEnv("NACH_ENABLED", "");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-key");

      const { checkMandateStatus } = await import(
        "../src/modules/nach/adapter.js"
      );

      await expect(checkMandateStatus("MNDT-001")).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });

    it("throws INTEGRATION_DISABLED for submitBulkPayment when disabled", async () => {
      vi.stubEnv("NACH_ENABLED", "false");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-key");

      const { submitBulkPayment } = await import(
        "../src/modules/nach/adapter.js"
      );

      await expect(
        submitBulkPayment({
          batchRef: "BATCH-001",
          mandateRef: "MNDT-001",
          totalAmountMinor: 50000000n,
          beneficiaryCount: 10,
          scheduledDate: "2026-08-05",
        }),
      ).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });
  });

  describe("happy path — submitMandate", () => {
    it("returns mandate result on successful response", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const mockResponse = {
        mandateRef: "MNDT-2026-0001",
        status: "submitted",
        umrn: "UMRN12345678901234",
        submittedAt: "2026-08-01T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { submitMandate } = await import("../src/modules/nach/adapter.js");
      const result = await submitMandate({
        employeeRef: "550e8400-e29b-41d4-a716-446655440001",
        amountMinor: 5000000n,
        frequency: "monthly",
        startDate: "2026-08-01",
        endDate: "2027-07-31",
        accountType: "savings",
      });

      expect(result).toEqual({
        mandateRef: "MNDT-2026-0001",
        status: "submitted",
        umrn: "UMRN12345678901234",
        submittedAt: "2026-08-01T10:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://nach.example.com/api/v1/mandates",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("happy path — checkMandateStatus", () => {
    it("returns mandate status on successful response", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const mockResponse = {
        mandateRef: "MNDT-2026-0001",
        status: "active",
        umrn: "UMRN12345678901234",
        lastUpdated: "2026-08-05T14:30:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { checkMandateStatus } = await import("../src/modules/nach/adapter.js");
      const result = await checkMandateStatus("MNDT-2026-0001");

      expect(result).toEqual({
        mandateRef: "MNDT-2026-0001",
        status: "active",
        umrn: "UMRN12345678901234",
        lastUpdated: "2026-08-05T14:30:00Z",
        reasonCode: undefined,
        reasonText: undefined,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://nach.example.com/api/v1/mandates/MNDT-2026-0001/status",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
          }),
        }),
      );
    });
  });

  describe("happy path — submitBulkPayment", () => {
    it("returns bulk payment result on successful response", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const mockResponse = {
        batchRef: "BATCH-2026-0001",
        transactionId: "TXN-NACH-12345",
        status: "submitted",
        submittedAt: "2026-08-05T09:00:00Z",
        beneficiaryCount: 25,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { submitBulkPayment } = await import("../src/modules/nach/adapter.js");
      const result = await submitBulkPayment({
        batchRef: "BATCH-2026-0001",
        mandateRef: "MNDT-2026-0001",
        totalAmountMinor: 125000000n,
        beneficiaryCount: 25,
        scheduledDate: "2026-08-10",
      });

      expect(result).toEqual({
        batchRef: "BATCH-2026-0001",
        transactionId: "TXN-NACH-12345",
        status: "submitted",
        submittedAt: "2026-08-05T09:00:00Z",
        beneficiaryCount: 25,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://nach.example.com/api/v1/payments/bulk",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-api-key",
            "Content-Type": "application/json",
          }),
        }),
      );
    });
  });

  describe("circuit breaker", () => {
    it("opens after 5 consecutive failures and rejects subsequent calls", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { submitMandate, getBreakerState } = await import(
        "../src/modules/nach/adapter.js"
      );
      const { CircuitBreakerOpenError } = await import(
        "@civitasone/circuit-breaker"
      );

      // First 5 calls should fail with the upstream error
      for (let i = 0; i < 5; i++) {
        await expect(
          submitMandate({
            employeeRef: "550e8400-e29b-41d4-a716-446655440001",
            amountMinor: 5000000n,
            frequency: "monthly",
            startDate: "2026-08-01",
            endDate: "2027-07-31",
            accountType: "savings",
          }),
        ).rejects.toMatchObject({
          code: "NACH_API_ERROR",
        });
      }

      // After 5 failures, the circuit breaker should be open
      expect(getBreakerState()).toBe("open");

      // 6th call should be rejected by the circuit breaker without hitting the API
      await expect(
        submitMandate({
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: 5000000n,
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        }),
      ).rejects.toBeInstanceOf(CircuitBreakerOpenError);

      // Verify fetch was called only 5 times (not for the 6th call)
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("timeout handling", () => {
    it("aborts request after configured timeout", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");
      vi.stubEnv("NACH_TIMEOUT_MS", "100");

      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            }
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { checkMandateStatus } = await import("../src/modules/nach/adapter.js");

      await expect(checkMandateStatus("MNDT-001")).rejects.toThrow("aborted");
    });
  });

  describe("error responses from upstream", () => {
    it("throws NACH_API_ERROR with HTTP status on non-2xx response", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { submitMandate } = await import("../src/modules/nach/adapter.js");

      await expect(
        submitMandate({
          employeeRef: "550e8400-e29b-41d4-a716-446655440001",
          amountMinor: 5000000n,
          frequency: "monthly",
          startDate: "2026-08-01",
          endDate: "2027-07-31",
          accountType: "savings",
        }),
      ).rejects.toMatchObject({
        code: "NACH_API_ERROR",
        httpStatus: 400,
      });
    });
  });

  describe("isEnabled helper", () => {
    it("returns true when all env vars are configured", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const { isEnabled } = await import("../src/modules/nach/adapter.js");
      expect(isEnabled()).toBe(true);
    });

    it("returns false when NACH_ENABLED is not true", async () => {
      vi.stubEnv("NACH_ENABLED", "false");
      vi.stubEnv("NACH_BASE_URL", "https://nach.example.com");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const { isEnabled } = await import("../src/modules/nach/adapter.js");
      expect(isEnabled()).toBe(false);
    });

    it("returns false when NACH_BASE_URL is empty", async () => {
      vi.stubEnv("NACH_ENABLED", "true");
      vi.stubEnv("NACH_BASE_URL", "");
      vi.stubEnv("NACH_API_KEY", "test-api-key");

      const { isEnabled } = await import("../src/modules/nach/adapter.js");
      expect(isEnabled()).toBe(false);
    });
  });
});
