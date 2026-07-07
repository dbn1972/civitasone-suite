/**
 * AI NL Search Translation tests.
 *
 * Covers:
 * - Happy path: NL query → structured intent → search results (mocked LLM)
 * - Disabled feature returns 404
 * - Query too long (>500 chars) returns 400
 * - Timeout handling returns 504
 * - Circuit breaker open returns 503
 *
 * Validates: Requirements 20.3
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

// ── Test: Feature disabled ────────────────────────────────────────

describe("NL Search — feature disabled", () => {
  it("POST /v1/knowledge/ai/search returns 404 when FEATURE_AI_ASSISTANT_ENABLED is not true", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "find all finance bills" }),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

// ── Test: Validation ──────────────────────────────────────────────

describe("NL Search — validation", () => {
  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns 400 when query exceeds 500 characters", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const longQuery = "a".repeat(501);
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: longQuery }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when query is empty string", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is missing query field", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
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
      url: "/v1/knowledge/ai/search",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "find bills" }),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

// ── Test: Happy path (mocked LLM + search) ───────────────────────

describe("NL Search — happy path", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("translates NL query to structured search and returns results", async () => {
    // Mock Anthropic API response with structured intent
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            module: "finance",
            entityType: "bill",
            keywords: ["pending", "bills", "approved"],
            filters: { status: "pending" },
          }),
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();

    // Mock the search engine via the nl-search module
    const mockSearchResponse = {
      hits: [
        {
          id: "doc-1",
          documentId: "doc-1",
          title: "Finance Bill #2024-001",
          content: "Pending bill for office supplies",
          tags: ["finance", "bill"],
          score: 0.95,
        },
        {
          id: "doc-2",
          documentId: "doc-2",
          title: "Finance Bill #2024-002",
          content: "Approved travel expense bill",
          tags: ["finance", "bill"],
          score: 0.87,
        },
      ],
      totalHits: 2,
      processingTimeMs: 15,
    };

    // Mock the search engine
    const { setEngine } = await import("../src/modules/ai/nl-search.js");
    setEngine({
      initialize: vi.fn(),
      index: vi.fn(),
      bulkIndex: vi.fn(),
      search: vi.fn().mockResolvedValue(mockSearchResponse),
      remove: vi.fn(),
      removeAll: vi.fn(),
      healthy: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    });

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "show me pending finance bills" }),
    });

    await app.close();
    setEngine(null);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.intent).toBeDefined();
    expect(body.data.intent.module).toBe("finance");
    expect(body.data.intent.keywords).toContain("pending");
    expect(body.data.results).toHaveLength(2);
    expect(body.data.results[0].title).toBe("Finance Bill #2024-001");
  });

  it("handles non-JSON LLM response gracefully (fallback to raw keywords)", async () => {
    // Mock Anthropic API with non-JSON response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: "I would search for: pending bills finance department",
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();

    const mockSearchResponse = {
      hits: [],
      totalHits: 0,
      processingTimeMs: 5,
    };

    const { setEngine } = await import("../src/modules/ai/nl-search.js");
    setEngine({
      initialize: vi.fn(),
      index: vi.fn(),
      bulkIndex: vi.fn(),
      search: vi.fn().mockResolvedValue(mockSearchResponse),
      remove: vi.fn(),
      removeAll: vi.fn(),
      healthy: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    });

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "pending bills" }),
    });

    await app.close();
    setEngine(null);

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.intent.module).toBeNull();
    expect(body.data.intent.keywords.length).toBeGreaterThan(0);
    expect(body.data.results).toHaveLength(0);
  });

  it("returns results with exact 500-char query (boundary)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            module: null,
            entityType: null,
            keywords: ["search"],
            filters: {},
          }),
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();

    const { setEngine } = await import("../src/modules/ai/nl-search.js");
    setEngine({
      initialize: vi.fn(),
      index: vi.fn(),
      bulkIndex: vi.fn(),
      search: vi.fn().mockResolvedValue({ hits: [], totalHits: 0, processingTimeMs: 2 }),
      remove: vi.fn(),
      removeAll: vi.fn(),
      healthy: vi.fn().mockResolvedValue(true),
      close: vi.fn(),
    });

    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const exactQuery = "a".repeat(500);
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: exactQuery }),
    });

    await app.close();
    setEngine(null);

    expect(res.statusCode).toBe(200);
  });
});

// ── Test: Timeout handling ────────────────────────────────────────

describe("NL Search — timeout handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("returns 503 when AI adapter times out", async () => {
    // Mock fetch to simulate abort (timeout)
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;

    vi.resetModules();
    vi.stubEnv("AI_TIMEOUT_MS", "1");
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "find documents" }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("AI_TIMEOUT");
  });
});

// ── Test: Circuit breaker ─────────────────────────────────────────

describe("NL Search — circuit breaker", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("returns 503 when circuit breaker is open", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return { ok: false, status: 500, text: async () => "internal error" };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    // Trip the circuit breaker with 5 failures on the prompt endpoint
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: "/v1/knowledge/ai/prompt",
        headers: {
          authorization: `Bearer ${makeToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ system: "test", userMessage: "hello" }),
      });
    }

    // Now the search route should also get circuit breaker open
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/search",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: "find documents" }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CIRCUIT_OPEN");
  });
});

// ── Test: parseIntent unit tests ──────────────────────────────────

describe("parseIntent", () => {
  it("parses valid JSON intent correctly", async () => {
    const { parseIntent } = await import("../src/modules/ai/nl-search.js");
    const intent = parseIntent(JSON.stringify({
      module: "finance",
      entityType: "bill",
      keywords: ["pending", "payment"],
      filters: { status: "approved" },
    }));

    expect(intent.module).toBe("finance");
    expect(intent.entityType).toBe("bill");
    expect(intent.keywords).toEqual(["pending", "payment"]);
    expect(intent.filters).toEqual({ status: "approved" });
  });

  it("handles null module and entityType", async () => {
    const { parseIntent } = await import("../src/modules/ai/nl-search.js");
    const intent = parseIntent(JSON.stringify({
      module: null,
      entityType: null,
      keywords: ["search", "term"],
      filters: {},
    }));

    expect(intent.module).toBeNull();
    expect(intent.entityType).toBeNull();
    expect(intent.keywords).toEqual(["search", "term"]);
  });

  it("falls back to splitting raw text when JSON parsing fails", async () => {
    const { parseIntent } = await import("../src/modules/ai/nl-search.js");
    const intent = parseIntent("search for pending finance bills");

    expect(intent.module).toBeNull();
    expect(intent.entityType).toBeNull();
    expect(intent.keywords).toEqual(["search", "for", "pending", "finance", "bills"]);
    expect(intent.filters).toEqual({});
  });

  it("handles malformed JSON gracefully", async () => {
    const { parseIntent } = await import("../src/modules/ai/nl-search.js");
    const intent = parseIntent("{invalid json!!!");

    expect(intent.module).toBeNull();
    expect(intent.keywords.length).toBeGreaterThan(0);
  });

  it("filters non-string values from keywords and filters", async () => {
    const { parseIntent } = await import("../src/modules/ai/nl-search.js");
    const intent = parseIntent(JSON.stringify({
      module: "finance",
      entityType: 123,
      keywords: ["valid", 42, null, "also_valid"],
      filters: { good: "value", bad: 123, alsoGood: "yes" },
    }));

    expect(intent.entityType).toBeNull();
    expect(intent.keywords).toEqual(["valid", "also_valid"]);
    expect(intent.filters).toEqual({ good: "value", alsoGood: "yes" });
  });
});
