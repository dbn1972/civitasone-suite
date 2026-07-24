/**
 * SVC-127 — pure domain unit tests: citation assembly, grounding-context
 * assembly, extractive fallback, deflection metrics, guided-flow steps.
 */
import { describe, it, expect } from "vitest";
import {
  assembleCitations,
  buildContext,
  extractiveAnswer,
  deflectionMetrics,
  normalizeSteps,
  extractKeyword,
  type GroundingSource,
} from "../src/modules/assistant/domain.js";

const sources: GroundingSource[] = [
  { id: "p1", title: "Leave Policy", body: "Staff accrue 30 days annual leave.", source: "policy" },
  { id: "d1", title: "HR Handbook", body: "", source: "document" },
  { id: "f1", title: "How do I apply for leave?", body: "Use the HRMS portal.", source: "faq" },
];

describe("citation assembly", () => {
  it("emits one citation per source in order", () => {
    const c = assembleCitations(sources);
    expect(c).toHaveLength(3);
    expect(c[0]).toEqual({ docId: "p1", title: "Leave Policy", source: "policy" });
    expect(c.map((x) => x.source)).toEqual(["policy", "document", "faq"]);
  });

  it("dedupes by (source,id)", () => {
    const c = assembleCitations([sources[0]!, sources[0]!]);
    expect(c).toHaveLength(1);
  });

  it("returns empty for no sources", () => {
    expect(assembleCitations([])).toEqual([]);
  });
});

describe("grounding context assembly", () => {
  it("joins sources with separators and tags", () => {
    const ctx = buildContext(sources);
    expect(ctx).toContain("[policy:p1] Leave Policy");
    expect(ctx).toContain("[faq:f1]");
    expect(ctx).toContain("---");
  });

  it("truncates to the char budget", () => {
    const ctx = buildContext(sources, 20);
    expect(ctx.length).toBeLessThanOrEqual(20);
  });

  it("stops cleanly when budget is exceeded mid-way", () => {
    const ctx = buildContext(sources, 40);
    expect(ctx.length).toBeLessThanOrEqual(40);
    expect(ctx).toContain("policy:p1");
  });
});

describe("extractive fallback answer", () => {
  it("returns the top source body snippet", () => {
    expect(extractiveAnswer(sources)).toBe("Staff accrue 30 days annual leave.");
  });

  it("falls back to the title when body is empty", () => {
    expect(extractiveAnswer([{ id: "d", title: "Only Title", body: "  ", source: "document" }])).toBe("Only Title");
  });

  it("returns empty string when there are no sources", () => {
    expect(extractiveAnswer([])).toBe("");
  });

  it("respects the maxChars bound", () => {
    const long = { id: "x", title: "t", body: "a".repeat(1000), source: "policy" as const };
    expect(extractiveAnswer([long], 10)).toHaveLength(10);
  });
});

describe("deflection metrics", () => {
  it("computes deflected/escalated rates", () => {
    const m = deflectionMetrics([
      { answered: true, escalated: false },
      { answered: true, escalated: false },
      { answered: true, escalated: true },
      { answered: false, escalated: true },
    ]);
    expect(m.total).toBe(4);
    expect(m.answered).toBe(3);
    expect(m.escalated).toBe(2);
    expect(m.deflected).toBe(2);
    expect(m.deflectionRate).toBe(50);
    expect(m.escalationRate).toBe(50);
  });

  it("zero interactions yields zero rates", () => {
    const m = deflectionMetrics([]);
    expect(m).toEqual({ total: 0, answered: 0, escalated: 0, deflected: 0, deflectionRate: 0, escalationRate: 0 });
  });
});

describe("guided-flow step normalisation", () => {
  it("assigns sequential 1-based order", () => {
    const steps = normalizeSteps([
      { title: "Open form", instruction: "Go to portal" },
      { title: "Submit", instruction: "Click submit" },
    ]);
    expect(steps).toEqual([
      { order: 1, title: "Open form", instruction: "Go to portal" },
      { order: 2, title: "Submit", instruction: "Click submit" },
    ]);
  });

  it("handles an empty step list", () => {
    expect(normalizeSteps([])).toEqual([]);
  });
});

describe("keyword extraction", () => {
  it("drops stop-words and short tokens", () => {
    expect(extractKeyword("How do I apply for leave?")).toBe("apply");
  });

  it("falls back to a trimmed slice when only stop-words remain", () => {
    expect(extractKeyword("is a")).toBe("is a");
  });
});
