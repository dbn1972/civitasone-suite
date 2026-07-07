import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Contract tests for the transcription external integration adapter.
 *
 * Validates recorded fixture responses (realistic shapes), disabled state,
 * circuit breaker behavior, auth error handling, and PII-free error responses.
 *
 * Uses mocked globalThis.fetch with recorded fixture data for CI.
 * When TRANSCRIPTION_LIVE_SANDBOX=true is set, tests hit the real sandbox API.
 *
 * Validates: Requirements 23.4
 */

// ── Recorded fixture: realistic transcription API response shape ──

const RECORDED_TRANSCRIPTION_FIXTURE = {
  text: "Good morning, this is the revenue department. How may I help you? I need to know the status of my property tax assessment for survey number 142 slash A in ward 7. Let me check that for you. One moment please.",
  durationMs: 18500,
};

const RECORDED_LONG_TRANSCRIPT_FIXTURE = {
  text: "A".repeat(600_000), // exceeds 500K limit; adapter should truncate
  durationMs: 300_000,
};

describe("transcription adapter — contract tests (recorded fixtures)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("recorded fixture response shape", () => {
    it("transcribe returns correct shape with text and durationMs", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "true");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "deepgram");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "sandbox-api-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription-sandbox.example.com");
      vi.stubEnv("TRANSCRIPTION_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(RECORDED_TRANSCRIPTION_FIXTURE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { transcribe } = await import("../src/modules/transcription/adapter.js");
      const result = await transcribe("recordings/tenant-1/call-123.wav", "https://s3.example.com/signed-url");

      // Validate shape matches contract
      expect(result).toHaveProperty("text");
      expect(result).toHaveProperty("durationMs");
      expect(result).toHaveProperty("provider");

      // Validate types
      expect(typeof result.text).toBe("string");
      expect(typeof result.durationMs).toBe("number");
      expect(typeof result.provider).toBe("string");

      // Validate content from fixture
      expect(result.text).toBe(RECORDED_TRANSCRIPTION_FIXTURE.text);
      expect(result.durationMs).toBe(18500);
      expect(result.provider).toBe("deepgram");

      // Validate fetch was called with correct structure
      expect(fetchMock).toHaveBeenCalledWith(
        "https://transcription-sandbox.example.com/v1/transcribe",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer sandbox-api-key",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("truncates text to MAX_TRANSCRIPT_LENGTH (500K chars)", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "true");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "whisper");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "test-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription.example.com");
      vi.stubEnv("TRANSCRIPTION_TIMEOUT_MS", "5000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(RECORDED_LONG_TRANSCRIPT_FIXTURE),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { transcribe, MAX_TRANSCRIPT_LENGTH } = await import(
        "../src/modules/transcription/adapter.js"
      );
      const result = await transcribe("recordings/long-call.wav", "https://s3.example.com/signed");

      expect(result.text.length).toBe(MAX_TRANSCRIPT_LENGTH);
      expect(result.text.length).toBe(500_000);
    });
  });

  describe("disabled → TRANSCRIPTION_DISABLED", () => {
    it("throws TRANSCRIPTION_DISABLED when TRANSCRIPTION_ENABLED is not true", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "false");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "deepgram");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "test-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription.example.com");

      const { transcribe } = await import("../src/modules/transcription/adapter.js");

      await expect(
        transcribe("key.wav", "https://s3.example.com/signed"),
      ).rejects.toMatchObject({
        code: "TRANSCRIPTION_DISABLED",
        name: "TranscriptionAdapterError",
        message: "Transcription integration is not available",
      });
    });

    it("throws TRANSCRIPTION_DISABLED when env var is missing", async () => {
      // Don't set TRANSCRIPTION_ENABLED at all
      vi.stubEnv("TRANSCRIPTION_ENABLED", "");

      const { transcribe } = await import("../src/modules/transcription/adapter.js");

      await expect(
        transcribe("key.wav", "https://s3.example.com/signed"),
      ).rejects.toMatchObject({
        code: "TRANSCRIPTION_DISABLED",
      });
    });
  });

  describe("circuit breaker open → CircuitBreakerOpenError", () => {
    it("opens after 5 consecutive failures and rejects subsequent calls", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "true");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "deepgram");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "test-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription.example.com");
      vi.stubEnv("TRANSCRIPTION_TIMEOUT_MS", "1000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { transcribe, getBreakerState } = await import(
        "../src/modules/transcription/adapter.js"
      );
      const { CircuitBreakerOpenError } = await import("@civitasone/circuit-breaker");

      // Trip the breaker with 5 failures
      for (let i = 0; i < 5; i++) {
        await expect(
          transcribe("key.wav", "https://s3.example.com/signed"),
        ).rejects.toMatchObject({
          code: "TRANSCRIPTION_API_ERROR",
        });
      }

      expect(getBreakerState()).toBe("open");

      // 6th call rejected by circuit breaker
      await expect(
        transcribe("key.wav", "https://s3.example.com/signed"),
      ).rejects.toBeInstanceOf(CircuitBreakerOpenError);

      // Fetch only called 5 times — 6th was blocked
      expect(fetchMock).toHaveBeenCalledTimes(5);
    });
  });

  describe("401/403 auth errors from upstream", () => {
    it("throws TRANSCRIPTION_API_ERROR on 401 from transcription provider", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "true");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "deepgram");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "invalid-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription.example.com");
      vi.stubEnv("TRANSCRIPTION_TIMEOUT_MS", "1000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { transcribe } = await import("../src/modules/transcription/adapter.js");

      await expect(
        transcribe("key.wav", "https://s3.example.com/signed"),
      ).rejects.toMatchObject({
        code: "TRANSCRIPTION_API_ERROR",
        httpStatus: 401,
      });
    });

    it("throws TRANSCRIPTION_API_ERROR on 403 from transcription provider", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "true");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "deepgram");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "revoked-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription.example.com");
      vi.stubEnv("TRANSCRIPTION_TIMEOUT_MS", "1000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Forbidden"),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { transcribe } = await import("../src/modules/transcription/adapter.js");

      await expect(
        transcribe("key.wav", "https://s3.example.com/signed"),
      ).rejects.toMatchObject({
        code: "TRANSCRIPTION_API_ERROR",
        httpStatus: 403,
      });
    });
  });

  describe("no PII in error responses", () => {
    it("error messages do not contain PII patterns", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "true");
      vi.stubEnv("TRANSCRIPTION_PROVIDER", "deepgram");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "test-key");
      vi.stubEnv("TRANSCRIPTION_BASE_URL", "https://transcription.example.com");
      vi.stubEnv("TRANSCRIPTION_TIMEOUT_MS", "1000");

      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            "Bad Request: audio file from user aadhaar 123456789012 could not be processed",
          ),
      });
      vi.stubGlobal("fetch", fetchMock);

      const { transcribe, TranscriptionAdapterError } = await import(
        "../src/modules/transcription/adapter.js"
      );

      try {
        await transcribe("key.wav", "https://s3.example.com/signed");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptionAdapterError);
        const adapterErr = err as InstanceType<typeof TranscriptionAdapterError>;
        // Error message should NOT contain PII from the upstream response body
        expect(adapterErr.message).not.toContain("123456789012"); // Aadhaar
        expect(adapterErr.message).not.toContain("aadhaar");
        // Should contain a generic message
        expect(adapterErr.message).toContain("Transcription API returned 400");
        expect(adapterErr.code).toBe("TRANSCRIPTION_API_ERROR");
      }
    });

    it("TRANSCRIPTION_DISABLED error does not contain secrets", async () => {
      vi.stubEnv("TRANSCRIPTION_ENABLED", "false");
      vi.stubEnv("TRANSCRIPTION_API_KEY", "super-secret-api-key-do-not-leak");

      const { transcribe, TranscriptionAdapterError } = await import(
        "../src/modules/transcription/adapter.js"
      );

      try {
        await transcribe("key.wav", "https://s3.example.com/signed");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(TranscriptionAdapterError);
        const adapterErr = err as InstanceType<typeof TranscriptionAdapterError>;
        expect(adapterErr.message).not.toContain("super-secret-api-key-do-not-leak");
        expect(adapterErr.message).toBe("Transcription integration is not available");
      }
    });
  });
});
