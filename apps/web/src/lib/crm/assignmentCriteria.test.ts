import { describe, it, expect } from "vitest";
import { schemaFor, validateCriteria, summariseCriteria } from "./assignmentCriteria";

describe("assignmentCriteria schemas (GAP-CRM-ASSIGNMENT-RULES-01)", () => {
  it("rejects a territory rule carrying a product/segment-style {region} blob", () => {
    // The old editor accepted ANY object, so {"region":"west"} on a Territory
    // row was saved and silently never matched (engine reads `territory`).
    expect(schemaFor("territory").safeParse({ region: "west" }).success).toBe(false);
    expect(validateCriteria("territory", { region: "west" }).ok).toBe(false);
  });

  it("accepts a well-formed territory criteria", () => {
    const ok = { territory: "west", ownerId: "u-1" };
    expect(schemaFor("territory").safeParse(ok).success).toBe(true);
    expect(validateCriteria("territory", ok).ok).toBe(true);
  });

  it("score_threshold rejects {region:'west'} and requires a numeric threshold", () => {
    expect(validateCriteria("score_threshold", { region: "west" }).ok).toBe(false);
    expect(validateCriteria("score_threshold", { threshold: 80, ownerId: "u-1" }).ok).toBe(true);
    expect(validateCriteria("score_threshold", { threshold: "80", ownerId: "u-1" }).ok).toBe(false);
  });

  it("product/segment/language need value + ownerId", () => {
    for (const t of ["product", "segment", "language"] as const) {
      expect(validateCriteria(t, { value: "GST", ownerId: "u-1" }).ok).toBe(true);
      expect(validateCriteria(t, { foo: 1 }).ok).toBe(false);
    }
  });

  it("round_robin needs a non-empty roster and a currentIndex", () => {
    expect(validateCriteria("round_robin", { roster: ["a", "b"], currentIndex: 0 }).ok).toBe(true);
    expect(validateCriteria("round_robin", { roster: [], currentIndex: 0 }).ok).toBe(false);
    expect(validateCriteria("round_robin", { roster: ["a"] }).ok).toBe(false);
  });

  it("capacity needs a non-empty roster", () => {
    expect(validateCriteria("capacity", { roster: ["a"] }).ok).toBe(true);
    expect(validateCriteria("capacity", { roster: [] }).ok).toBe(false);
  });

  it("tolerates extra keys the backend may carry (passthrough)", () => {
    expect(validateCriteria("territory", { territory: "west", ownerId: "u-1", note: "x" }).ok).toBe(true);
  });

  it("treats an empty criteria object as valid (legacy-lenient, routes to fallback)", () => {
    expect(validateCriteria("territory", {}).ok).toBe(true);
    expect(summariseCriteria("territory", {})).toMatch(/fallback/i);
  });

  it("summarises a valid rule in plain language", () => {
    expect(summariseCriteria("territory", { territory: "west", ownerId: "u-1" })).toContain("west");
    expect(summariseCriteria("score_threshold", { threshold: 80, ownerId: "u-1" })).toContain("80");
  });
});
