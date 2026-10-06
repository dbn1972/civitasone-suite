import { describe, it, expect } from "vitest";
import { normalizeRag, ragLabel, ragPillVariant } from "./rag";

describe("normalizeRag", () => {
  it("folds the canonical list vocabulary (green/amber/red)", () => {
    expect(normalizeRag("green")).toBe("green");
    expect(normalizeRag("amber")).toBe("amber");
    expect(normalizeRag("red")).toBe("red");
  });

  it("folds the delay-analysis vocabulary (active/review/overdue) onto the same three", () => {
    expect(normalizeRag("active")).toBe("green");
    expect(normalizeRag("review")).toBe("amber");
    expect(normalizeRag("overdue")).toBe("red");
  });

  it("treats 'delayed' as red", () => {
    expect(normalizeRag("delayed")).toBe("red");
  });

  it("is case- and separator-insensitive", () => {
    expect(normalizeRag("  Amber ")).toBe("amber");
    expect(normalizeRag("AT_RISK")).toBe("amber");
    expect(normalizeRag("on-track")).toBe("green");
  });

  it("returns null for unknown / missing values", () => {
    expect(normalizeRag("purple")).toBeNull();
    expect(normalizeRag("")).toBeNull();
    expect(normalizeRag(null)).toBeNull();
    expect(normalizeRag(undefined)).toBeNull();
  });
});

describe("ragLabel / ragPillVariant", () => {
  it("maps each RAG value to its label and tone", () => {
    expect(ragLabel("green")).toBe("Green");
    expect(ragLabel("amber")).toBe("Amber");
    expect(ragLabel("red")).toBe("Red");
    expect(ragLabel(null)).toBe("—");

    expect(ragPillVariant("green")).toBe("good");
    expect(ragPillVariant("amber")).toBe("warn");
    expect(ragPillVariant("red")).toBe("bad");
    expect(ragPillVariant(null)).toBe("info");
  });
});
