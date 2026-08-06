import { describe, it, expect } from "vitest";
import {
  availableSectionIds,
  isPrerequisiteSatisfied,
  resolveSectionAvailability,
} from "../src/prerequisites.js";
import { question, section } from "./fixtures.js";

describe("isPrerequisiteSatisfied", () => {
  it("is satisfied at or above the threshold", () => {
    expect(isPrerequisiteSatisfied({ sectionId: "s1", minScore: 80 }, { s1: 80 })).toBe(true);
    expect(isPrerequisiteSatisfied({ sectionId: "s1", minScore: 80 }, { s1: 90 })).toBe(true);
  });

  it("is unsatisfied below the threshold", () => {
    expect(isPrerequisiteSatisfied({ sectionId: "s1", minScore: 80 }, { s1: 79 })).toBe(false);
  });

  it("is unsatisfied when the prerequisite section has no score", () => {
    expect(isPrerequisiteSatisfied({ sectionId: "missing", minScore: 1 }, { s1: 100 })).toBe(false);
  });
});

describe("resolveSectionAvailability", () => {
  it("makes sections without a prerequisite available", () => {
    const sections = [section("s1", [question("q1")])];
    expect(resolveSectionAvailability(sections, { s1: 0 })).toEqual({ s1: true });
  });

  it("unlocks a gated section once the gate scores enough", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [question("q2")], {
        sortOrder: 2,
        prerequisite: { sectionId: "s1", minScore: 100 },
      }),
    ];
    expect(resolveSectionAvailability(sections, { s1: 50, s2: 0 })).toEqual({ s1: true, s2: false });
    expect(resolveSectionAvailability(sections, { s1: 100, s2: 0 })).toEqual({ s1: true, s2: true });
  });

  it("propagates a locked gate down a chain", () => {
    const sections = [
      section("a", [question("q1")]),
      section("b", [question("q2")], { sortOrder: 2, prerequisite: { sectionId: "a", minScore: 100 } }),
      section("c", [question("q3")], { sortOrder: 3, prerequisite: { sectionId: "b", minScore: 0 } }),
    ];
    // b's own score satisfies c's zero threshold, but b is locked, so c must stay locked.
    const availability = resolveSectionAvailability(sections, { a: 0, b: 100, c: 0 });
    expect(availability).toEqual({ a: true, b: false, c: false });
  });

  it("unlocks a whole chain once the root is satisfied", () => {
    const sections = [
      section("a", [question("q1")]),
      section("b", [question("q2")], { sortOrder: 2, prerequisite: { sectionId: "a", minScore: 100 } }),
      section("c", [question("q3")], { sortOrder: 3, prerequisite: { sectionId: "b", minScore: 100 } }),
    ];
    expect(resolveSectionAvailability(sections, { a: 100, b: 100, c: 0 })).toEqual({
      a: true,
      b: true,
      c: true,
    });
  });

  it("locks a section whose prerequisite names a section that does not exist", () => {
    const sections = [
      section("s1", [question("q1")], { prerequisite: { sectionId: "ghost", minScore: 1 } }),
    ];
    expect(resolveSectionAvailability(sections, { s1: 100 })).toEqual({ s1: false });
  });

  it("locks every section in a prerequisite cycle instead of looping forever", () => {
    const sections = [
      section("a", [question("q1")], { prerequisite: { sectionId: "b", minScore: 0 } }),
      section("b", [question("q2")], { sortOrder: 2, prerequisite: { sectionId: "a", minScore: 0 } }),
    ];
    expect(resolveSectionAvailability(sections, { a: 100, b: 100 })).toEqual({ a: false, b: false });
  });

  it("returns an empty map for an empty structure", () => {
    expect(resolveSectionAvailability([], {})).toEqual({});
  });
});

describe("availableSectionIds", () => {
  it("lists available sections in author order", () => {
    const sections = [
      section("s1", [question("q1")]),
      section("s2", [question("q2")], {
        sortOrder: 2,
        prerequisite: { sectionId: "s1", minScore: 100 },
      }),
    ];
    expect(availableSectionIds(sections, { s1: 100, s2: 0 })).toEqual(["s1", "s2"]);
    expect(availableSectionIds(sections, { s1: 0, s2: 0 })).toEqual(["s1"]);
  });
});
