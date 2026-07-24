/**
 * SVC-127 grounded assistant — unit tests with a STUBBED model adapter.
 *
 * The live model call is env-gated (FEATURE_AI_ASSISTANT_ENABLED + an Anthropic
 * API key); it is never invoked in CI. These tests mock the `ai` adapter and the
 * grounding repos so the grounding/citation assembly and both the AI-enabled and
 * AI-unavailable answer paths are exercised deterministically without a network
 * call or a database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const adapterState = { enabled: true, send: vi.fn(async () => "AI grounded answer") };

vi.mock("../src/modules/ai/adapter.js", async () => {
  const actual = await vi.importActual<typeof import("../src/modules/ai/adapter.js")>(
    "../src/modules/ai/adapter.js",
  );
  return {
    ...actual,
    isEnabled: () => adapterState.enabled,
    sendPrompt: (...args: unknown[]) => adapterState.send(...(args as [])),
  };
});

vi.mock("../src/modules/policies/repo.js", () => ({
  searchPublished: vi.fn(async () => [
    { id: "pol-1", title: "Leave Policy", body: "Staff accrue 30 days of annual leave." },
  ]),
}));
vi.mock("../src/modules/documents/repo.js", () => ({
  searchByTenant: vi.fn(async () => [{ id: "doc-1", title: "HR Handbook" }]),
}));
vi.mock("../src/modules/assistant/repo.js", () => ({
  searchFaqs: vi.fn(async () => [{ id: "faq-1", question: "How to apply for leave?", answer: "Use HRMS." }]),
}));

import { AiAdapterError } from "../src/modules/ai/adapter.js";
import { gatherSources, answerQuestion } from "../src/modules/assistant/grounded.js";

const TENANT = "dddddddd-0000-4000-8000-000000000001";

beforeEach(() => {
  adapterState.enabled = true;
  adapterState.send = vi.fn(async () => "AI grounded answer");
});

describe("gatherSources", () => {
  it("collects policy, document and FAQ grounding sources", async () => {
    const sources = await gatherSources(TENANT, "how do I apply for leave");
    expect(sources.map((s) => s.source)).toEqual(["policy", "document", "faq"]);
    expect(sources[0]).toMatchObject({ id: "pol-1", source: "policy" });
    expect(sources[2]).toMatchObject({ id: "faq-1", source: "faq" });
  });
});

describe("answerQuestion", () => {
  it("uses the model when enabled and returns its answer + citations", async () => {
    const res = await answerQuestion(TENANT, "how do I apply for leave");
    expect(res.usedAi).toBe(true);
    expect(res.answered).toBe(true);
    expect(res.grounded).toBe(true);
    expect(res.answer).toBe("AI grounded answer");
    expect(res.citations).toHaveLength(3);
    expect(adapterState.send).toHaveBeenCalledOnce();
  });

  it("falls back to an extractive answer when the model returns empty text", async () => {
    adapterState.send = vi.fn(async () => "   ");
    const res = await answerQuestion(TENANT, "leave");
    expect(res.usedAi).toBe(false);
    expect(res.answered).toBe(true);
    expect(res.answer).toContain("Staff accrue 30 days");
  });

  it("falls back to extractive when the adapter is disabled (env-gated, no key)", async () => {
    adapterState.enabled = false;
    const res = await answerQuestion(TENANT, "leave");
    expect(res.usedAi).toBe(false);
    expect(res.grounded).toBe(true);
    expect(res.answer).toContain("Staff accrue 30 days");
  });

  it("falls back to extractive when the model call throws an AiAdapterError", async () => {
    adapterState.send = vi.fn(async () => {
      throw new AiAdapterError("boom", "AI_API_ERROR");
    });
    const res = await answerQuestion(TENANT, "leave");
    expect(res.usedAi).toBe(false);
    expect(res.answered).toBe(true);
  });

  it("re-throws unexpected (non-adapter) errors", async () => {
    adapterState.send = vi.fn(async () => {
      throw new Error("unexpected");
    });
    await expect(answerQuestion(TENANT, "leave")).rejects.toThrow("unexpected");
  });
});

describe("answerQuestion with no grounding", () => {
  it("returns an unanswered result when no sources match", async () => {
    const policyRepo = await import("../src/modules/policies/repo.js");
    const docRepo = await import("../src/modules/documents/repo.js");
    const faqRepo = await import("../src/modules/assistant/repo.js");
    vi.mocked(policyRepo.searchPublished).mockResolvedValueOnce([]);
    vi.mocked(docRepo.searchByTenant).mockResolvedValueOnce([]);
    vi.mocked(faqRepo.searchFaqs).mockResolvedValueOnce([]);

    const res = await answerQuestion(TENANT, "nothing matches here");
    expect(res.grounded).toBe(false);
    expect(res.answered).toBe(false);
    expect(res.citations).toEqual([]);
  });
});
