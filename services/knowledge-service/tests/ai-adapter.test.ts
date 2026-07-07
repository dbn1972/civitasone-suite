/**
 * AI Assistant adapter + routes tests.
 *
 * Covers:
 * - Disabled state returns 404 (env gate)
 * - Happy path with mocked Anthropic API
 * - Circuit breaker opens after 5 failures → 503
 * - Timeout handling → 503
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";

function makeToken(roles: string[] = ["knowledge_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

// ── Test: Feature disabled (default in test env) ──────────────────

describe("AI routes — feature disabled", () => {
  it("POST /v1/knowledge/ai/prompt returns 404 when FEATURE_AI_ASSISTANT_ENABLED is not true", async () => {
    // Default env has no FEATURE_AI_ASSISTANT_ENABLED set
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/prompt",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system: "You are a helpful assistant",
        userMessage: "Hello",
      }),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

// ── Test: Feature enabled — happy path + circuit breaker ──────────

describe("AI routes — feature enabled", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Enable the feature for these tests by mocking the module
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("returns 200 with AI response on happy path (mocked)", async () => {
    // Mock fetch to return a successful Anthropic response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "This is the AI response" }],
      }),
    }) as unknown as typeof fetch;

    // Re-import to pick up env changes
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/prompt",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system: "You are a helpful assistant",
        userMessage: "What is CivitasOne?",
        maxTokens: 512,
      }),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.response).toBe("This is the AI response");
  });

  it("returns 400 for invalid request body", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/prompt",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ system: "", userMessage: "" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 without auth token", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/prompt",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        system: "test",
        userMessage: "hello",
      }),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when circuit breaker opens after 5 failures", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      return { ok: false, status: 500, text: async () => "internal error" };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    // Make 5 calls that will fail to trip the circuit breaker
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/knowledge/ai/prompt",
        headers: {
          authorization: `Bearer ${makeToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          system: "test",
          userMessage: "hello",
        }),
      });
    }

    // 6th call should get circuit breaker open response (503)
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/prompt",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system: "test",
        userMessage: "hello",
      }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CIRCUIT_OPEN");
  });

  it("returns 503 on timeout", async () => {
    // Mock fetch to simulate abort (timeout)
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      // Simulate the abort signal being triggered
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;

    vi.resetModules();
    // Set a very short timeout for testing
    vi.stubEnv("AI_TIMEOUT_MS", "1");
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/prompt",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        system: "test",
        userMessage: "hello",
      }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    const body = res.json();
    expect(body.error.code).toBe("AI_TIMEOUT");
  });
});
