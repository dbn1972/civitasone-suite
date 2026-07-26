/**
 * CAP-119 — document intelligence / classification.
 *
 * Covers: deterministic keyword classifier, LLM-disabled fallback via the route,
 * and LLM-enabled path with a mocked adapter.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { sqlClient } from "../src/shared/db.js";
import { classifyByKeywords, classifyDocument } from "../src/modules/ai/classify.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
function makeToken(roles: string[] = ["knowledge_user"]) {
  return signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);
}

afterAll(async () => {
  await sqlClient.end();
});

describe("classifyByKeywords (deterministic)", () => {
  it("classifies a finance document", () => {
    const r = classifyByKeywords("The annual budget audit found the invoice and payment ledger in order for fiscal review.");
    expect(r.category).toBe("finance");
    expect(r.method).toBe("keyword");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("classifies a legal document", () => {
    const r = classifyByKeywords("The court petition and affidavit were filed; the judgment cites the relevant statute and clause.");
    expect(r.category).toBe("legal");
  });

  it("classifies a procurement document", () => {
    const r = classifyByKeywords("The tender was floated; each vendor submitted a bid and quotation for the purchase.");
    expect(r.category).toBe("procurement");
  });

  it("returns general with zero confidence when no keywords match", () => {
    const r = classifyByKeywords("the quick brown fox jumps over lazy dogs again and again");
    expect(r.category).toBe("general");
    expect(r.confidence).toBe(0);
  });

  it("honours a custom category lexicon", () => {
    const r = classifyByKeywords("zebra zebra antelope", { wildlife: ["zebra", "antelope"] });
    expect(r.category).toBe("wildlife");
  });
});

describe("classifyDocument (LLM disabled → keyword fallback)", () => {
  it("falls back to keyword classification when the feature is off", async () => {
    const r = await classifyDocument("budget invoice payment audit fiscal grant disbursement");
    expect(r.method).toBe("keyword");
    expect(r.category).toBe("finance");
  });
});

describe("classifyDocument (LLM enabled)", () => {
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

  it("uses the LLM label when the API returns valid JSON", async () => {
    vi.resetModules();
    const mod = await import("../src/modules/ai/classify.js");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"category":"hr","confidence":0.9}' }] }),
    }) as unknown as typeof fetch;
    const r = await mod.classifyDocument("employee recruitment leave salary promotion");
    expect(r.method).toBe("llm");
    expect(r.category).toBe("hr");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("falls back to keyword when the LLM returns unparseable output", async () => {
    vi.resetModules();
    const mod = await import("../src/modules/ai/classify.js");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "not json at all" }] }),
    }) as unknown as typeof fetch;
    const r = await mod.classifyDocument("tender vendor bid purchase quotation");
    expect(r.method).toBe("keyword");
    expect(r.category).toBe("procurement");
  });
});

describe("POST /v1/knowledge/ai/classify route", () => {
  it("returns 400 on empty text", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/classify",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "" }),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/classify",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "budget audit invoice" }),
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("classifies text (keyword fallback, feature disabled)", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/knowledge/ai/classify",
      headers: { authorization: `Bearer ${makeToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ text: "The court petition and affidavit and judgment cite the statute." }),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.category).toBe("legal");
    expect(res.json().data.method).toBe("keyword");
  });
});
