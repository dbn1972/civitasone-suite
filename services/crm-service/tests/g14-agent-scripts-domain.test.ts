/**
 * G14 — Agent talking-point script library: pure domain tests.
 *
 * Validates the three domain functions:
 * - resolveScript: picks the latest published script for product+language with 'en' fallback
 * - canPublish: only draft → published
 * - canDeprecate: only published → deprecated
 */
import { describe, it, expect } from "vitest";
import { resolveScript, canPublish, canDeprecate } from "../src/modules/agent-scripts/domain.js";
import type { AgentScriptView } from "../src/modules/agent-scripts/schema.js";

function makeScript(overrides: Partial<AgentScriptView> = {}): AgentScriptView {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    tenantId: "t1",
    productCode: "LIFE_TERM",
    language: "hi",
    scriptKey: "intro",
    title: "परिचय",
    body: "नमस्ते, मैं आपकी जीवन बीमा योजना के बारे में बात करना चाहता हूँ।",
    versionNumber: 1,
    status: "published",
    tags: ["intro", "life"],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    createdBy: "actor-1",
    updatedBy: "actor-1",
    version: 1,
    ...overrides,
  };
}

describe("resolveScript", () => {
  it("returns the exact language+product match when published", () => {
    const scripts = [
      makeScript({ id: "s1", language: "hi", productCode: "LIFE_TERM", versionNumber: 1 }),
      makeScript({ id: "s2", language: "en", productCode: "LIFE_TERM", versionNumber: 1 }),
    ];
    const result = resolveScript("LIFE_TERM", "hi", scripts);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("s1");
    expect(result!.language).toBe("hi");
  });

  it("picks the highest version_number among published scripts for the same key", () => {
    const scripts = [
      makeScript({ id: "s1", versionNumber: 1 }),
      makeScript({ id: "s2", versionNumber: 3 }),
      makeScript({ id: "s3", versionNumber: 2 }),
    ];
    const result = resolveScript("LIFE_TERM", "hi", scripts);
    expect(result!.id).toBe("s2");
    expect(result!.versionNumber).toBe(3);
  });

  it("falls back to English when the requested language has no published script", () => {
    const scripts = [
      makeScript({ id: "s1", language: "en", productCode: "LIFE_TERM" }),
      makeScript({ id: "s2", language: "hi", productCode: "LIFE_TERM", status: "draft" }),
    ];
    const result = resolveScript("LIFE_TERM", "hi", scripts);
    expect(result!.id).toBe("s1");
    expect(result!.language).toBe("en");
  });

  it("returns null when no published scripts exist at all", () => {
    const scripts = [
      makeScript({ id: "s1", status: "draft" }),
      makeScript({ id: "s2", status: "deprecated" }),
    ];
    expect(resolveScript("LIFE_TERM", "hi", scripts)).toBeNull();
  });

  it("returns null on an empty list", () => {
    expect(resolveScript("LIFE_TERM", "hi", [])).toBeNull();
  });

  it("does not fall back when the requested language is already 'en'", () => {
    const scripts = [
      makeScript({ id: "s1", language: "hi", productCode: "LIFE_TERM" }),
    ];
    // Requesting 'en' — the 'hi' script should NOT be returned as fallback
    expect(resolveScript("LIFE_TERM", "en", scripts)).toBeNull();
  });

  it("ignores scripts for a different product_code", () => {
    const scripts = [
      makeScript({ id: "s1", language: "hi", productCode: "HEALTH_BASIC" }),
    ];
    expect(resolveScript("LIFE_TERM", "hi", scripts)).toBeNull();
  });

  it("ignores deprecated scripts even if they match product+language", () => {
    const scripts = [
      makeScript({ id: "s1", status: "deprecated", language: "hi", productCode: "LIFE_TERM" }),
    ];
    expect(resolveScript("LIFE_TERM", "hi", scripts)).toBeNull();
  });

  it("falls back to the highest-versioned English script when exact language is absent", () => {
    const scripts = [
      makeScript({ id: "s1", language: "en", productCode: "LIFE_TERM", versionNumber: 1 }),
      makeScript({ id: "s2", language: "en", productCode: "LIFE_TERM", versionNumber: 5 }),
    ];
    const result = resolveScript("LIFE_TERM", "ta", scripts);
    expect(result!.id).toBe("s2");
    expect(result!.versionNumber).toBe(5);
  });
});

describe("canPublish", () => {
  it("allows publishing a draft script", () => {
    expect(canPublish({ status: "draft" })).toBe(true);
  });

  it("rejects publishing an already-published script", () => {
    expect(canPublish({ status: "published" })).toBe(false);
  });

  it("rejects publishing a deprecated script", () => {
    expect(canPublish({ status: "deprecated" })).toBe(false);
  });
});

describe("canDeprecate", () => {
  it("allows deprecating a published script", () => {
    expect(canDeprecate({ status: "published" })).toBe(true);
  });

  it("rejects deprecating a draft script", () => {
    expect(canDeprecate({ status: "draft" })).toBe(false);
  });

  it("rejects deprecating an already-deprecated script", () => {
    expect(canDeprecate({ status: "deprecated" })).toBe(false);
  });
});
