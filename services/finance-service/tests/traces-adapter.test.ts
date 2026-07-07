import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Tests for the TRACES adapter module.
 *
 * Covers:
 * - Disabled adapter returns INTEGRATION_DISABLED error
 * - Happy path: submitTdsReturn, verifyPanStatus, downloadForm16
 * - Circuit breaker opens after 5 consecutive failures
 * - Timeout handling (15s default)
 *
 * Validates: Requirements 22.1, 22.2, 22.4, 22.6, 22.7
 */

describe("TRACES adapter", () => {
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
    it("throws INTEGRATION_DISABLED when TRACES_ENABLED is not 'true'", async () => {
      vi.stubEnv("TRACES_ENABLED", "false");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-key");

      const { submitTdsReturn } = await import(
        "../src/modules/traces/adapter.js"
      );

      await expect(submitTdsReturn({
        tanNumber: "MUMB12345A",
        formType: "26Q",
        quarter: "Q1",
        financialYear: "2025-26",
        deductees: [{
          pan: "ABCDE1234F",
          name: "Test Vendor",
          amountPaidMinor: 100000n,
          tdsDeductedMinor: 2000n,
          section: "194C",
        }],
      })).rejects.toThrow(
        expect.objectContaining({
          code: "INTEGRATION_DISABLED",
          message: "TRACES integration is not available",
        }),
      );
    });

    it("throws INTEGRATION_DISABLED when TRACES_ENABLED is missing", async () => {
      vi.stubEnv("TRACES_ENABLED", "");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-key");

      const { verifyPanStatus } = await import("../src/modules/traces/adapter.js");

      await expect(verifyPanStatus("ABCDE1234F")).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });

    it("throws INTEGRATION_DISABLED for downloadForm16 when disabled", async () => {
      vi.stubEnv("TRACES_ENABLED", "false");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-key");

      const { downloadForm16 } = await import("../src/modules/traces/adapter.js");

      await expect(downloadForm16({
        tanNumber: "MUMB12345A",
        pan: "ABCDE1234F",
        financialYear: "2025-26",
      })).rejects.toMatchObject({
        code: "INTEGRATION_DISABLED",
      });
    });
  });

  describe("happy path — submitTdsReturn", () => {
    it("submits TDS return and returns token on success", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-api-key");

      const mockResponse = {
        tokenNumber: "TKN-2026-001234",
        status: "accepted",
        submittedAt: "2026-07-10T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { submitTdsReturn } = await import("../src/modules/traces/adapter.js");
      const result = await submitTdsReturn({
        tanNumber: "MUMB12345A",
        formType: "26Q",
        quarter: "Q1",
        financialYear: "2025-26",
        deductees: [{
          pan: "ABCDE1234F",
          name: "Test Vendor",
          amountPaidMinor: 100000n,
          tdsDeductedMinor: 2000n,
          section: "194C",
        }],
      });

      expect(result).toEqual({
        tokenNumber: "TKN-2026-001234",
        status: "accepted",
        submittedAt: "2026-07-10T10:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://traces.example.com/api/v1/tds-returns",
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

  describe("happy path — verifyPanStatus", () => {
    it("returns PAN status on successful response", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-api-key");

      const mockResponse = {
        pan: "ABCDE1234F",
        status: "valid",
        name: "REDACTED",
        lastVerifiedAt: "2026-07-10T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { verifyPanStatus } = await import("../src/modules/traces/adapter.js");
      const result = await verifyPanStatus("ABCDE1234F");

      expect(result).toEqual({
        pan: "ABCDE1234F",
        status: "valid",
        name: "REDACTED",
        lastVerifiedAt: "2026-07-10T10:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://traces.example.com/api/v1/pan-status/ABCDE1234F",
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

  describe("happy path — downloadForm16", () => {
    it("returns download URL on successful response", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-api-key");

      const mockResponse = {
        downloadUrl: "https://traces.example.com/downloads/form16-abc123.pdf",
        fileFormat: "pdf",
        generatedAt: "2026-07-10T10:00:00Z",
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { downloadForm16 } = await import("../src/modules/traces/adapter.js");
      const result = await downloadForm16({
        tanNumber: "MUMB12345A",
        pan: "ABCDE1234F",
        financialYear: "2025-26",
        quarter: "Q2",
      });

      expect(result).toEqual({
        downloadUrl: "https://traces.example.com/downloads/form16-abc123.pdf",
        fileFormat: "pdf",
        generatedAt: "2026-07-10T10:00:00Z",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://traces.example.com/api/v1/form16?tan=MUMB12345A&pan=ABCDE1234F&fy=2025-26&quarter=Q2",
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
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { verifyPanStatus, getBreakerState } = await import(
        "../src/modules/traces/adapter.js"
      );
      const { CircuitBreakerOpenError } = await import(
        "@civitasone/circuit-breaker"
      );

      // First 5 calls should fail with the upstream error
      for (let i = 0; i < 5; i++) {
        await expect(verifyPanStatus("ABCDE1234F")).rejects.toMatchObject({
          code: "TRACES_API_ERROR",
        });
      }

      // After 5 failures, the circuit breaker should be open
      expect(getBreakerState()).toBe("open");

      // 6th call should be rejected by the circuit breaker without hitting the API
      await expect(verifyPanStatus("ABCDE1234F")).rejects.toBeInstanceOf(
        CircuitBreakerOpenError,
      );

      // Verify fetch was called only 5 times (not for the 6th call)
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("timeout handling", () => {
    it("aborts request after configured timeout", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-api-key");
      vi.stubEnv("TRACES_TIMEOUT_MS", "100");

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

      const { verifyPanStatus } = await import("../src/modules/traces/adapter.js");

      await expect(verifyPanStatus("ABCDE1234F")).rejects.toThrow("aborted");
    });
  });

  describe("upstream error handling (no PII in errors)", () => {
    it("returns structured error with code and status but no response body", async () => {
      vi.stubEnv("TRACES_ENABLED", "true");
      vi.stubEnv("TRACES_BASE_URL", "https://traces.example.com");
      vi.stubEnv("TRACES_API_KEY", "test-api-key");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: () => Promise.resolve("PAN ABCDE1234F is invalid — contains PII"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { verifyPanStatus, TracesAdapterError } = await import(
        "../src/modules/traces/adapter.js"
      );

      await expect(verifyPanStatus("ABCDE1234F")).rejects.toMatchObject({
        code: "TRACES_API_ERROR",
        httpStatus: 422,
      });

      // Verify the error message does NOT contain PII from the upstream response
      try {
        await verifyPanStatus("ABCDE1234F");
      } catch (err: any) {
        expect(err.message).not.toContain("ABCDE1234F");
        expect(err.message).toBe("TRACES API returned 422");
      }
    });
  });
});
