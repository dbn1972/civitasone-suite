import { describe, it, expect } from "vitest";
import { SKILL_BASELINE_LEVEL, toLevel } from "./skillLevels";

describe("toLevel (GAP-HR-SKILLS-03)", () => {
  it("maps the backend vocabulary 1:1 onto levels 1-4 so level 3 is reachable", () => {
    expect(toLevel("beginner")).toBe(1);
    expect(toLevel("intermediate")).toBe(2);
    expect(toLevel("advanced")).toBe(3);
    expect(toLevel("expert")).toBe(4);
  });

  it("keeps advanced and expert distinct", () => {
    expect(toLevel("advanced")).not.toBe(toLevel("expert"));
  });

  it("keeps the legacy synonyms on sensible levels", () => {
    expect(toLevel("basic")).toBe(1);
    expect(toLevel("developing")).toBe(2);
    expect(toLevel("proficient")).toBe(3);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(toLevel("Advanced")).toBe(3);
    expect(toLevel("  EXPERT ")).toBe(4);
  });

  it("returns 0 (not assessed) for unknown, empty or missing values", () => {
    expect(toLevel("wizard")).toBe(0);
    expect(toLevel("")).toBe(0);
    expect(toLevel(null)).toBe(0);
    expect(toLevel(undefined)).toBe(0);
  });
});

describe("SKILL_BASELINE_LEVEL", () => {
  it("is Advanced (3), the level the matrix legend names", () => {
    expect(SKILL_BASELINE_LEVEL).toBe(3);
    expect(toLevel("advanced")).toBe(SKILL_BASELINE_LEVEL);
  });
});
