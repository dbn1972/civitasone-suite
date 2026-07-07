import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the GSTN adapter module.
 *
 * Covers:
 * - Disabled adapter returns INTEGRATION_DISABLED error (fail-closed)
 * - Happy path: submitGstReturn, verifyGstin, fetchReturnStatus
 * - Circuit breaker opens after 5 consecutive failures
 * - Timeout handling (15s default)
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.6, 22.7
 */

describe("GSTN adapter", () => {
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
    it("throws INTEGRATION_DISABLED when GSTN_ENABLED is not 'true'", async () => {
      vi.stubEnv("GSTN_ENABLED", "false");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-key");

      const { submitGstReturn } = await import(
        "../src/modules/gstn/adapter.js"
      );

      await expect(submitGstReturn({
        gstin: "22AAAAA0000A1Z5",
        returnPeriod: "01/2026",
        returnType: "GSTR3B",
        totalTaxableValue: "100000",
        totalCgst: "9000",
        totalSgst: "9000",
        totalIgst: "0",
      })).rejects.toThrow(
        expect.objectContaining({
          code: "INTEGRATION_DISABLED",
          message: "GSTN integration is not available",
        }),
      );
    });

    it("throws INTEGRATION_DISABLED when GSTN_ENABLED is missing", async () => {
      vi.stubEnv("GSTN_ENABLED", "");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-key");

      const { verifyGstin } = await import("../src/modules/gstn/adapter.js");

      await expect(verifyGstin("22AAAAA0000A1Z5")).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });

    it("throws INTEGRATION_DISABLED for fetchReturnStatus when disabled", async () => {
      vi.stubEnv("GSTN_ENABLED", "false");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-key");

      const { fetchReturnStatus } = await import("../src/modules/gstn/adapter.js");

      await expect(fetchReturnStatus("REF-001")).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });
  });

  describe("happy path — submitGstReturn", () => {
    it("returns submission result on successful response", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-api-key");

      const mockResponse = {
        referenceId: "GSTN-RET-2026-001",
        status: "submitted",
        gstin: "22AAAAA0000A1Z5",
        returnPeriod: "01/2026",
        submittedAt: "2026-07-10T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { submitGstReturn } = await import("../src/modules/gstn/adapter.js");
      const result = await submitGstReturn({
        gstin: "22AAAAA0000A1Z5",
        returnPeriod: "01/2026",
        returnType: "GSTR3B",
        totalTaxableValue: "100000",
        totalCgst: "9000",
        totalSgst: "9000",
        totalIgst: "0",
      });

      expect(result).toEqual({
        referenceId: "GSTN-RET-2026-001",
        status: "submitted",
        gstin: "22AAAAA0000A1Z5",
        returnPeriod: "01/2026",
        submittedAt: "2026-07-10T10:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://gstn.example.com/api/v1/returns",
        expect.objectContaining({
          method: "POST",
          headers: {
            Authorization: "Bearer test-api-key",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }),
      );
    });
  });

  describe("happy path — verifyGstin", () => {
    it("returns verification result on successful response", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-api-key");

      const mockResponse = {
        gstin: "22AAAAA0000A1Z5",
        legalName: "Test Corporation Ltd",
        tradeName: "Test Corp",
        status: "active",
        registrationDate: "2017-07-01",
        lastUpdated: "2026-07-10T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { verifyGstin } = await import("../src/modules/gstn/adapter.js");
      const result = await verifyGstin("22AAAAA0000A1Z5");

      expect(result).toEqual({
        gstin: "22AAAAA0000A1Z5",
        legalName: "Test Corporation Ltd",
        tradeName: "Test Corp",
        status: "active",
        registrationDate: "2017-07-01",
        lastUpdated: "2026-07-10T10:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://gstn.example.com/api/v1/gstin/22AAAAA0000A1Z5/verify",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer test-api-key",
            Accept: "application/json",
          },
        }),
      );
    });
  });

  describe("happy path — fetchReturnStatus", () => {
    it("returns status result on successful response", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-api-key");

      const mockResponse = {
        referenceId: "GSTN-RET-2026-001",
        status: "filed",
        returnPeriod: "01/2026",
        filedAt: "2026-07-11T09:00:00Z",
        lastUpdated: "2026-07-11T09:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { fetchReturnStatus } = await import("../src/modules/gstn/adapter.js");
      const result = await fetchReturnStatus("GSTN-RET-2026-001");

      expect(result).toEqual({
        referenceId: "GSTN-RET-2026-001",
        status: "filed",
        returnPeriod: "01/2026",
        filedAt: "2026-07-11T09:00:00Z",
        rejectionReason: undefined,
        lastUpdated: "2026-07-11T09:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://gstn.example.com/api/v1/returns/GSTN-RET-2026-001/status",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer test-api-key",
            Accept: "application/json",
          },
        }),
      );
    });
  });

  describe("circuit breaker", () => {
    it("opens after 5 consecutive failures and rejects subsequent calls", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { verifyGstin, getBreakerState } = await import(
        "../src/modules/gstn/adapter.js"
      );
      const { CircuitBreakerOpenError } = await import(
        "@civitasone/circuit-breaker"
      );

      // First 5 calls should fail with the upstream error
      for (let i = 0; i < 5; i++) {
        await expect(verifyGstin("22AAAAA0000A1Z5")).rejects.toMatchObject({
          code: "GSTN_API_ERROR",
        });
      }

      // After 5 failures, the circuit breaker should be open
      expect(getBreakerState()).toBe("open");

      // 6th call should be rejected by the circuit breaker without hitting the API
      await expect(verifyGstin("22AAAAA0000A1Z5")).rejects.toBeInstanceOf(
        CircuitBreakerOpenError,
      );

      // Verify fetch was called only 5 times (not for the 6th call)
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("timeout handling", () => {
    it("aborts request after configured timeout", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-api-key");
      vi.stubEnv("GSTN_TIMEOUT_MS", "100");

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

      const { submitGstReturn } = await import("../src/modules/gstn/adapter.js");

      await expect(submitGstReturn({
        gstin: "22AAAAA0000A1Z5",
        returnPeriod: "01/2026",
        returnType: "GSTR3B",
        totalTaxableValue: "100000",
        totalCgst: "9000",
        totalSgst: "9000",
        totalIgst: "0",
      })).rejects.toThrow("aborted");
    });
  });

  describe("no PII in error handling", () => {
    it("error from non-ok response does not expose upstream body", async () => {
      vi.stubEnv("GSTN_ENABLED", "true");
      vi.stubEnv("GSTN_BASE_URL", "https://gstn.example.com");
      vi.stubEnv("GSTN_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("Sensitive upstream body with PII"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { verifyGstin, GstnAdapterError } = await import(
        "../src/modules/gstn/adapter.js"
      );

      try {
        await verifyGstin("22AAAAA0000A1Z5");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(GstnAdapterError);
        // Error message should NOT contain the upstream response body
        expect((err as Error).message).toBe("GSTN API returned 422");
        expect((err as Error).message).not.toContain("Sensitive");
      }
    });
  });
});
