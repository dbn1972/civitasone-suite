/**
 * AI Grievance Auto-Triage integration tests.
 *
 * Covers:
 * - Happy path: text → AI recommendation (mocked LLM)
 * - Feature disabled returns 404
 * - Validation: empty text returns 400, text > 2000 chars returns 400
 * - Circuit breaker open returns 503
 * - PII is redacted before sending to LLM
 *
 * Validates: Requirements 20.6
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const GRIEVANCE_ID = "bbbbbbbb-2222-4000-8000-000000000001";

function makeToken(roles: string[] = ["citizen_officer"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

// ── Test: Feature disabled ────────────────────────────────────────

describe("Grievance Auto-Triage — feature disabled", () => {
  it("POST /v1/citizen/grievances/:id/auto-triage returns 404 when FEATURE_AI_ASSISTANT_ENABLED is not true", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Water pipe burst in my neighbourhood" }),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error.code).toBe("FEATURE_NOT_AVAILABLE");
  });
});

// ── Test: Validation ──────────────────────────────────────────────

describe("Grievance Auto-Triage — validation", () => {
  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns 400 when text is empty", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when text exceeds 2000 characters", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const longText = "a".repeat(2001);
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: longText }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is missing text field", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
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

  it("returns 400 when grievance ID is not a valid UUID", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/citizen/grievances/not-a-uuid/auto-triage",
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Water pipe burst" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts text at exactly 2000 characters (boundary)", async () => {
    // Mock the AI adapter to return a valid response
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            category: "water",
            priority: "medium",
            department: "Water Supply Department",
            confidence: 0.7,
          }),
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const exactText = "a".repeat(2000);
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: exactText }),
    });
    await app.close();
    globalThis.fetch = globalThis.fetch;
    expect(res.statusCode).toBe(202);
  });

  it("returns 401 without auth token", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Water issue" }),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when user lacks officer role", async () => {
    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const citizenToken = signToken(
      { sub: "citizen-001", tid: TENANT, roles: ["citizen"], sid: "sess-002" },
      SECRET,
    );

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${citizenToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Water pipe burst" }),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ── Test: Happy path (mocked LLM) ────────────────────────────────

describe("Grievance Auto-Triage — happy path", () => {
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

  it("returns 202 with triage recommendation from AI", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            category: "water",
            priority: "high",
            department: "Water Supply Department",
            confidence: 0.92,
          }),
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Water pipe burst in sector 15, flooding the road and affecting 200 families" }),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.category).toBe("water");
    expect(body.data.priority).toBe("high");
    expect(body.data.department).toBe("Water Supply Department");
    expect(body.data.confidence).toBe(0.92);
    expect(body.data.aiSuggested).toBe(true);
    expect(body.data.grievanceId).toBe(GRIEVANCE_ID);
    expect(body.data.message).toContain("recommendation");
  });

  it("redacts PII before sending to LLM", async () => {
    let capturedBody: string | undefined;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody = init.body as string;
      return {
        ok: true,
        json: async () => ({
          content: [{
            type: "text",
            text: JSON.stringify({
              category: "general",
              priority: "medium",
              department: "Revenue Department",
              confidence: 0.6,
            }),
          }],
        }),
      };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const textWithPii = "My name is John, phone 9876543210, PAN ABCDE1234F, Aadhaar 1234 5678 9012, email test@example.com. Fix the road.";

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: textWithPii }),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    // Verify PII was redacted in the request to Anthropic
    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    const userMessage = parsed.messages[0].content;
    expect(userMessage).not.toContain("9876543210");
    expect(userMessage).not.toContain("ABCDE1234F");
    expect(userMessage).not.toContain("1234 5678 9012");
    expect(userMessage).not.toContain("test@example.com");
    expect(userMessage).toContain("[PHONE]");
    expect(userMessage).toContain("[PAN]");
    expect(userMessage).toContain("[AADHAAR]");
    expect(userMessage).toContain("[EMAIL]");
  });

  it("handles malformed AI response gracefully with fallback defaults", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: "I'm not sure how to categorize this grievance",
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Something is wrong in my area" }),
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    // Fallback values when AI response is not valid JSON
    expect(body.data.category).toBe("general");
    expect(body.data.priority).toBe("medium");
    expect(body.data.department).toBe("General Administration");
    expect(body.data.confidence).toBe(0.3);
    expect(body.data.aiSuggested).toBe(true);
  });
});

// ── Test: Circuit breaker ─────────────────────────────────────────

describe("Grievance Auto-Triage — circuit breaker", () => {
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

  it("returns 503 when circuit breaker is open after 5 failures", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return { ok: false, status: 500, text: async () => "internal error" };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    // Trip the circuit breaker with 5 failures
    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: "POST",
        url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
        headers: {
          authorization: `Bearer ${makeToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: "Water issue in my area" }),
      });
    }

    // 6th call should get circuit breaker open
    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Another water issue" }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("CIRCUIT_OPEN");
  });
});

// ── Test: Timeout handling ────────────────────────────────────────

describe("Grievance Auto-Triage — timeout handling", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-123");
    vi.stubEnv("AI_TIMEOUT_MS", "1");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("returns 503 when AI adapter times out", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: `/v1/citizen/grievances/${GRIEVANCE_ID}/auto-triage`,
      headers: {
        authorization: `Bearer ${makeToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ text: "Electricity outage in my block" }),
    });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("AI_TIMEOUT");
  });
});

// ── Test: parseTriageResponse unit tests ──────────────────────────

describe("parseTriageResponse", () => {
  it("parses valid JSON response correctly", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");
    const result = parseTriageResponse(JSON.stringify({
      category: "water",
      priority: "high",
      department: "Water Supply",
      confidence: 0.85,
    }));

    expect(result.category).toBe("water");
    expect(result.priority).toBe("high");
    expect(result.department).toBe("Water Supply");
    expect(result.confidence).toBe(0.85);
  });

  it("handles invalid category by defaulting to general", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");
    const result = parseTriageResponse(JSON.stringify({
      category: "invalid_category",
      priority: "medium",
      department: "Some Dept",
      confidence: 0.7,
    }));

    expect(result.category).toBe("general");
  });

  it("handles invalid priority by defaulting to medium", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");
    const result = parseTriageResponse(JSON.stringify({
      category: "roads",
      priority: "urgent",
      department: "PWD",
      confidence: 0.8,
    }));

    expect(result.priority).toBe("medium");
  });

  it("handles markdown code block wrapper", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");
    const result = parseTriageResponse('```json\n{"category":"sanitation","priority":"low","department":"Sanitation Dept","confidence":0.6}\n```');

    expect(result.category).toBe("sanitation");
    expect(result.priority).toBe("low");
    expect(result.department).toBe("Sanitation Dept");
    expect(result.confidence).toBe(0.6);
  });

  it("falls back to defaults on completely invalid response", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");
    const result = parseTriageResponse("I cannot determine the category");

    expect(result.category).toBe("general");
    expect(result.priority).toBe("medium");
    expect(result.department).toBe("General Administration");
    expect(result.confidence).toBe(0.3);
  });

  it("clamps confidence to 0-1 range", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");

    const resultHigh = parseTriageResponse(JSON.stringify({
      category: "water",
      priority: "high",
      department: "Water",
      confidence: 1.5,
    }));
    expect(resultHigh.confidence).toBe(0.5); // invalid → default

    const resultNeg = parseTriageResponse(JSON.stringify({
      category: "water",
      priority: "high",
      department: "Water",
      confidence: -0.2,
    }));
    expect(resultNeg.confidence).toBe(0.5); // invalid → default
  });

  it("truncates department name longer than 200 chars", async () => {
    const { parseTriageResponse } = await import("../src/modules/ai/auto-triage.js");
    const longDept = "A".repeat(300);
    const result = parseTriageResponse(JSON.stringify({
      category: "water",
      priority: "medium",
      department: longDept,
      confidence: 0.7,
    }));

    expect(result.department.length).toBe(200);
  });
});
