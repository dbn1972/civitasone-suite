import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the e-Courts adapter module.
 *
 * Covers:
 * - Happy path CNR lookup
 * - Disabled adapter returns INTEGRATION_DISABLED error
 * - Circuit breaker opens after 5 consecutive failures
 * - Timeout handling
 *
 * Validates: Requirements 10.1, 10.6
 */

// We need to control env vars before importing the adapter,
// so we use dynamic imports and vi.stubEnv.

describe("e-Courts adapter", () => {
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
    it("throws INTEGRATION_DISABLED when ECOURTS_ENABLED is not 'true'", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "false");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "test-key");

      const { lookupCnr, ECourtsAdapterError } = await import(
        "../src/modules/ecourts/adapter.js"
      );

      await expect(lookupCnr("DLHC010012345672026")).rejects.toThrow(
        expect.objectContaining({
          code: "INTEGRATION_DISABLED",
          message: "e-Courts integration is not available",
        }),
      );
    });

    it("throws INTEGRATION_DISABLED when ECOURTS_ENABLED is missing", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "test-key");

      const { lookupCnr } = await import("../src/modules/ecourts/adapter.js");

      await expect(lookupCnr("DLHC010012345672026")).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });
  });

  describe("happy path lookup", () => {
    it("returns case status, hearing dates, and orders on successful response", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "test-api-key");

      const mockResponse = {
        cnrNumber: "DLHC010012345672026",
        caseStatus: "pending",
        courtName: "High Court of Delhi",
        hearingDates: [
          { date: "2026-08-15", purpose: "Arguments" },
          { date: "2026-09-20", purpose: "Final hearing" },
        ],
        orders: [
          { date: "2026-07-01", description: "Interim stay granted" },
        ],
        lastUpdated: "2026-07-10T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { lookupCnr } = await import("../src/modules/ecourts/adapter.js");
      const result = await lookupCnr("DLHC010012345672026");

      expect(result).toEqual({
        cnrNumber: "DLHC010012345672026",
        caseStatus: "pending",
        courtName: "High Court of Delhi",
        hearingDates: [
          { date: "2026-08-15", purpose: "Arguments" },
          { date: "2026-09-20", purpose: "Final hearing" },
        ],
        orders: [
          { date: "2026-07-01", description: "Interim stay granted" },
        ],
        lastUpdated: "2026-07-10T10:00:00Z",
      });

      // Verify the URL and headers
      expect(fetchMock).toHaveBeenCalledWith(
        "https://ecourts.example.com/api/v1/cases/cnr/DLHC010012345672026",
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
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { lookupCnr, getBreakerState } = await import(
        "../src/modules/ecourts/adapter.js"
      );
      const { CircuitBreakerOpenError } = await import(
        "@civitasone/circuit-breaker"
      );

      // First 5 calls should fail with the upstream error
      for (let i = 0; i < 5; i++) {
        await expect(lookupCnr("CNR123")).rejects.toMatchObject({
          code: "ECOURTS_API_ERROR",
        });
      }

      // After 5 failures, the circuit breaker should be open
      expect(getBreakerState()).toBe("open");

      // 6th call should be rejected by the circuit breaker without hitting the API
      await expect(lookupCnr("CNR123")).rejects.toBeInstanceOf(
        CircuitBreakerOpenError,
      );

      // Verify fetch was called only 5 times (not for the 6th call)
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("timeout handling", () => {
    it("aborts request after configured timeout", async () => {
      vi.stubEnv("ECOURTS_ENABLED", "true");
      vi.stubEnv("ECOURTS_BASE_URL", "https://ecourts.example.com");
      vi.stubEnv("ECOURTS_API_KEY", "test-api-key");
      vi.stubEnv("ECOURTS_TIMEOUT_MS", "100");

      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            // Simulate a request that never completes, but responds to abort signal
            const signal = init.signal;
            if (signal) {
              signal.addEventListener("abort", () => {
                reject(new DOMException("The operation was aborted.", "AbortError"));
              });
            }
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { lookupCnr } = await import("../src/modules/ecourts/adapter.js");

      await expect(lookupCnr("CNR123")).rejects.toThrow("aborted");
    });
  });
});
