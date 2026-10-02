import { describe, it, expect } from "vitest";
import {
  TALENT_POOL_PAGE_SIZE, buildTalentPoolPath, candidateHref, hasActiveFilters, pageQuery, pageWindow, parseMinExp, parsePage, parseSource,
} from "./talentPoolView";

describe("talentPoolView", () => {
  it("parsePage falls back to 1 for junk", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-3")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("7")).toBe(7);
  });
  it("parseSource only accepts the two known sources", () => {
    expect(parseSource("internal")).toBe("internal");
    expect(parseSource("public_portal")).toBe("public_portal");
    expect(parseSource("'; drop")).toBeUndefined();
  });
  it("parseMinExp only accepts a small non-negative integer", () => {
    expect(parseMinExp("3")).toBe("3");
    expect(parseMinExp("-1")).toBeUndefined();
    expect(parseMinExp("2.5")).toBeUndefined();
    expect(parseMinExp("")).toBeUndefined();
  });
  it("buildTalentPoolPath paginates by offset and encodes every filter", () => {
    expect(buildTalentPoolPath({})).toBe(`/api/v1/hrms/talent-pool?limit=${TALENT_POOL_PAGE_SIZE}&offset=0`);
    const p = buildTalentPoolPath({ skill: " a&b ", minExp: "2", source: "internal", page: "3" });
    expect(p).toBe("/api/v1/hrms/talent-pool?limit=50&offset=100&skill=a%26b&minExp=2&source=internal");
  });
  it("hasActiveFilters ignores blanks and invalid values", () => {
    expect(hasActiveFilters({ skill: "  ", minExp: "x", source: "nope" })).toBe(false);
    expect(hasActiveFilters({ source: "internal" })).toBe(true);
  });
  it("pageQuery keeps filters and omits page 1", () => {
    expect(pageQuery({ skill: "go", source: "internal" }, 1)).toBe("skill=go&source=internal");
    expect(pageQuery({ skill: "go" }, 3)).toBe("skill=go&page=3");
  });
  it("candidateHref is empty without a vacancy id", () => {
    expect(candidateHref({ id: "a", jobOpeningId: null })).toBe("");
    expect(candidateHref({ id: "a" })).toBe("");
    expect(candidateHref({ id: "a", jobOpeningId: "j" })).toBe("/hr/recruitment/j/applications/a");
  });
  it("pageWindow reports range and prev/next", () => {
    expect(pageWindow(120, 2, 50)).toEqual({ from: 51, to: 100, hasPrev: true, hasNext: true });
    expect(pageWindow(120, 3, 20)).toEqual({ from: 101, to: 120, hasPrev: true, hasNext: false });
    expect(pageWindow(0, 1, 0)).toEqual({ from: 0, to: 0, hasPrev: false, hasNext: false });
  });
});
