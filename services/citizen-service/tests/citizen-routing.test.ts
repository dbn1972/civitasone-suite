/**
 * Enhanced citizen request routing integration tests.
 *
 * Covers:
 * - Happy path: LLM-based routing with mocked adapter (classification, sentiment, urgency)
 * - Fallback to keyword-based triage when LLM unavailable
 * - PII redaction before sending to LLM
 * - Advisory flag always present in response
 * - Sentiment classification correctness (keyword fallback)
 * - Urgency scoring correctness (keyword fallback)
 * - Validation: invalid ID returns 400
 * - Auth: missing token returns 401, wrong role returns 403
 * - Text similarity computation
 * - Resolution template recommendations
 *
 * Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const REQUEST_ID = "cccccccc-3333-4000-8000-000000000001";

function makeToken(roles: string[] = ["citizen_officer"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

// ── Test: Validation ──────────────────────────────────────────────

describe("Citizen Request Routing — validation", () => {
  it("returns 400 when request ID is not a valid UUID", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/citizen/requests/not-a-uuid/routing?text=Water+issue",
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 401 without auth token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Water+issue`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when user lacks officer role", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const citizenToken = signToken(
      { sub: "citizen-001", tid: TENANT, roles: ["citizen"], sid: "sess-002" },
      SECRET,
    );

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Water+issue`,
      headers: { authorization: `Bearer ${citizenToken}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 when no text provided and request not in DB", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

// ── Test: Keyword fallback (LLM disabled) ─────────────────────────

describe("Citizen Request Routing — keyword fallback", () => {
  it("returns 200 with fallback classification when FEATURE_AI_ASSISTANT_ENABLED is not true", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Water+pipe+burst+in+my+area+causing+flooding`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.advisory).toBe(true);
    expect(body.data.isFallback).toBe(true);
    expect(body.data.categories).toBeInstanceOf(Array);
    expect(body.data.categories.length).toBeGreaterThan(0);
    // Water keywords should match
    expect(body.data.categories[0].category).toBe("water");
    expect(body.data.categories[0].confidence).toBeGreaterThan(0);
    expect(body.data.sentiment).toBeDefined();
    expect(body.data.urgency).toBeDefined();
    expect(body.data.similarComplaints).toBeInstanceOf(Array);
    expect(body.data.resolutionSuggestions).toBeInstanceOf(Array);
    expect(body.data.requestId).toBe(REQUEST_ID);
    expect(body.data.message).toContain("suggestions");
  });

  it("classifies urgency correctly via keywords", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    // Critical urgency
    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=People+are+dying+due+to+the+fire+emergency`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.urgency).toBe("critical");
  });

  it("classifies negative sentiment via keywords", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=I+am+frustrated+and+angry+about+the+terrible+road+conditions`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sentiment).toBe("negative");
  });

  it("classifies positive sentiment via keywords", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Thank+you+for+resolving+my+issue+I+am+grateful`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.sentiment).toBe("positive");
  });

  it("returns general category when no keywords match", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=xyz+abc+123`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.categories[0].category).toBe("general");
    expect(body.data.isFallback).toBe(true);
  });
});

// ── Test: Happy path (mocked LLM) ────────────────────────────────

describe("Citizen Request Routing — happy path (mocked LLM)", () => {
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

  it("returns 200 with LLM-based routing when adapter is available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: JSON.stringify({
            categories: [
              { category: "water", confidence: 0.92 },
              { category: "infrastructure", confidence: 0.65 },
            ],
            sentiment: "negative",
            urgency: "high",
          }),
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Major+water+pipe+burst+flooding+entire+neighbourhood`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.advisory).toBe(true);
    expect(body.data.isFallback).toBe(false);
    expect(body.data.categories).toHaveLength(2);
    expect(body.data.categories[0].category).toBe("water");
    expect(body.data.categories[0].confidence).toBe(0.92);
    expect(body.data.categories[1].category).toBe("infrastructure");
    expect(body.data.sentiment).toBe("negative");
    expect(body.data.urgency).toBe("high");
    expect(body.data.similarComplaints).toBeInstanceOf(Array);
    expect(body.data.resolutionSuggestions).toBeInstanceOf(Array);
    expect(body.data.requestId).toBe(REQUEST_ID);
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
              categories: [{ category: "general", confidence: 0.7 }],
              sentiment: "neutral",
              urgency: "medium",
            }),
          }],
        }),
      };
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const textWithPii = "My phone 9876543210, PAN ABCDE1234F, Aadhaar 1234 5678 9012, email test@example.com. Fix the road.";

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=${encodeURIComponent(textWithPii)}`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
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

  it("falls back to keywords when LLM returns error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Water+supply+problem+in+sector+15`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.isFallback).toBe(true);
    expect(body.data.advisory).toBe(true);
    expect(body.data.categories[0].category).toBe("water");
  });

  it("handles malformed LLM response by falling back to defaults", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{
          type: "text",
          text: "I don't understand the request",
        }],
      }),
    }) as unknown as typeof fetch;

    vi.resetModules();
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Some+issue+in+my+area`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // LLM response was unparseable, but we still get a valid response (not fallback since LLM was called)
    expect(body.data.isFallback).toBe(false);
    expect(body.data.categories[0].category).toBe("general");
    expect(body.data.advisory).toBe(true);
  });
});

// ── Test: Domain logic (unit tests) ──────────────────────────────

describe("Citizen Request Routing — domain logic", () => {
  it("classifyWithKeywords handles multi-label categories", async () => {
    const { classifyWithKeywords } = await import("../src/modules/routing/domain.js");

    const result = classifyWithKeywords("The road near the water pipe is damaged and there is flooding");
    expect(result.categories.length).toBeGreaterThanOrEqual(2);
    // Should include both water and roads
    const cats = result.categories.map((c) => c.category);
    expect(cats).toContain("water");
    expect(cats).toContain("roads");
  });

  it("computeTextSimilarity returns 1.0 for identical texts", async () => {
    const { computeTextSimilarity } = await import("../src/modules/routing/domain.js");
    const similarity = computeTextSimilarity(
      "Water pipe burst in sector 15",
      "Water pipe burst in sector 15",
    );
    expect(similarity).toBe(1.0);
  });

  it("computeTextSimilarity returns 0 for completely different texts", async () => {
    const { computeTextSimilarity } = await import("../src/modules/routing/domain.js");
    const similarity = computeTextSimilarity(
      "aaaa bbbb cccc dddd eeee",
      "xxxx yyyy zzzz wwww vvvv",
    );
    expect(similarity).toBe(0);
  });

  it("computeTextSimilarity returns value between 0 and 1 for partial overlap", async () => {
    const { computeTextSimilarity } = await import("../src/modules/routing/domain.js");
    const similarity = computeTextSimilarity(
      "Water pipe burst in my street causing flooding",
      "Water pipe leak in the neighborhood with flooding issues",
    );
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it("computeTextSimilarity returns 0 for empty texts", async () => {
    const { computeTextSimilarity } = await import("../src/modules/routing/domain.js");
    expect(computeTextSimilarity("", "something")).toBe(0);
    expect(computeTextSimilarity("something", "")).toBe(0);
    expect(computeTextSimilarity("", "")).toBe(0);
  });

  it("findSimilarComplaints only returns complaints above 0.80 threshold", async () => {
    const { findSimilarComplaints } = await import("../src/modules/routing/domain.js");

    const existingComplaints = [
      { id: "c1", text: "Water pipe burst in sector 15 causing flooding in the area", summary: "Water pipe burst" },
      { id: "c2", text: "Water pipe burst in sector 15 causing flooding in the area nearby", summary: "Water pipe burst sector 15" },
      { id: "c3", text: "Completely unrelated topic about school education policy reform in the state", summary: "Education policy" },
    ];

    const results = findSimilarComplaints(
      "Water pipe burst in sector 15 causing flooding in the area and streets",
      existingComplaints,
    );

    // Should find similar ones (above 0.80) but not the unrelated one
    for (const r of results) {
      expect(r.similarity).toBeGreaterThan(0.80);
    }
    const ids = results.map((r) => r.requestId);
    expect(ids).not.toContain("c3");
  });

  it("recommendResolutions returns top 3 sorted by confidence", async () => {
    const { recommendResolutions } = await import("../src/modules/routing/domain.js");

    const templates = [
      { id: "t1", title: "Water pipe repair procedure", text: "Procedure for repairing broken water pipe in residential area with flooding" },
      { id: "t2", title: "Electricity restoration guide", text: "Guide for restoring electricity after power outage transformer failure" },
      { id: "t3", title: "Road pothole repair", text: "Steps for repairing potholes and road damage in the city streets" },
      { id: "t4", title: "Water supply restoration", text: "Process for restoring water supply after pipe burst and flooding damage" },
    ];

    const results = recommendResolutions(
      "Water pipe burst causing flooding damage in residential area",
      templates,
    );

    expect(results.length).toBeLessThanOrEqual(3);
    // Should be sorted by confidence descending
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].confidence).toBeGreaterThanOrEqual(results[i + 1].confidence);
    }
  });

  it("parseLlmRoutingResponse handles valid JSON", async () => {
    const { parseLlmRoutingResponse } = await import("../src/modules/routing/domain.js");
    const result = parseLlmRoutingResponse(JSON.stringify({
      categories: [
        { category: "water", confidence: 0.9 },
        { category: "roads", confidence: 0.6 },
      ],
      sentiment: "negative",
      urgency: "high",
    }));

    expect(result.categories).toHaveLength(2);
    expect(result.categories[0].category).toBe("water");
    expect(result.categories[0].confidence).toBe(0.9);
    expect(result.sentiment).toBe("negative");
    expect(result.urgency).toBe("high");
  });

  it("parseLlmRoutingResponse handles invalid categories gracefully", async () => {
    const { parseLlmRoutingResponse } = await import("../src/modules/routing/domain.js");
    const result = parseLlmRoutingResponse(JSON.stringify({
      categories: [{ category: "invalid_cat", confidence: 0.9 }],
      sentiment: "neutral",
      urgency: "medium",
    }));

    // Invalid category filtered out, defaults to general
    expect(result.categories[0].category).toBe("general");
  });

  it("parseLlmRoutingResponse handles invalid sentiment/urgency", async () => {
    const { parseLlmRoutingResponse } = await import("../src/modules/routing/domain.js");
    const result = parseLlmRoutingResponse(JSON.stringify({
      categories: [{ category: "water", confidence: 0.8 }],
      sentiment: "furious",
      urgency: "extreme",
    }));

    expect(result.sentiment).toBe("neutral");
    expect(result.urgency).toBe("medium");
  });

  it("parseLlmRoutingResponse handles non-JSON response", async () => {
    const { parseLlmRoutingResponse } = await import("../src/modules/routing/domain.js");
    const result = parseLlmRoutingResponse("I cannot classify this request");

    expect(result.categories[0].category).toBe("general");
    expect(result.categories[0].confidence).toBe(0.3);
    expect(result.sentiment).toBe("neutral");
    expect(result.urgency).toBe("medium");
  });

  it("parseLlmRoutingResponse handles markdown-wrapped JSON", async () => {
    const { parseLlmRoutingResponse } = await import("../src/modules/routing/domain.js");
    const result = parseLlmRoutingResponse('```json\n{"categories":[{"category":"sanitation","confidence":0.85}],"sentiment":"negative","urgency":"high"}\n```');

    expect(result.categories[0].category).toBe("sanitation");
    expect(result.sentiment).toBe("negative");
    expect(result.urgency).toBe("high");
  });

  it("parseLlmRoutingResponse limits categories to 3", async () => {
    const { parseLlmRoutingResponse } = await import("../src/modules/routing/domain.js");
    const result = parseLlmRoutingResponse(JSON.stringify({
      categories: [
        { category: "water", confidence: 0.9 },
        { category: "roads", confidence: 0.8 },
        { category: "sanitation", confidence: 0.7 },
        { category: "health", confidence: 0.6 },
      ],
      sentiment: "neutral",
      urgency: "medium",
    }));

    expect(result.categories).toHaveLength(3);
  });
});

// ── Test: Advisory flag (always present) ──────────────────────────

describe("Citizen Request Routing — advisory flag", () => {
  it("always includes advisory: true in response", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: `/v1/citizen/requests/${REQUEST_ID}/routing?text=Road+pothole+issue`,
      headers: { authorization: `Bearer ${makeToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data.advisory).toBe(true);
  });
});
