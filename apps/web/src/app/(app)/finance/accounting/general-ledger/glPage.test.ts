import { describe, it, expect } from "vitest";
import { GL_PAGE_SIZE, glQuery, glRange, parseGlView } from "./glPage";

const NOW = new Date("2026-09-15T05:00:00Z"); // FY 2026-27

describe("parseGlView", () => {
  it("defaults to the current FY, All tab, no search, page 1", () => {
    expect(parseGlView(undefined, NOW)).toEqual({ fy: "2026-27", tab: "All", q: "", page: 1 });
  });
  it("accepts a valid fy / type / q / page", () => {
    expect(parseGlView({ fy: "2025-26", type: "receipt", q: " V-12 ", page: "3" }, NOW)).toEqual({ fy: "2025-26", tab: "Receipt", q: "V-12", page: 3 });
  });
  it("falls back to defaults for junk instead of throwing", () => {
    expect(parseGlView({ fy: "2026-28", type: "contra", page: "-4" }, NOW)).toEqual({ fy: "2026-27", tab: "All", q: "", page: 1 });
    expect(parseGlView({ page: "abc" }, NOW).page).toBe(1);
    expect(parseGlView({ q: "x".repeat(500) }, NOW).q).toHaveLength(100);
  });
});

describe("glQuery", () => {
  it("omits defaults and round-trips a non-default view", () => {
    expect(glQuery({ fy: "2026-27", tab: "All", q: "", page: 1 }, NOW)).toBe("");
    const q = glQuery({ fy: "2025-26", tab: "Payment", q: "cash", page: 2 }, NOW);
    expect(q).toBe("?fy=2025-26&type=payment&q=cash&page=2");
    const sp = Object.fromEntries(new URLSearchParams(q.slice(1)));
    expect(parseGlView(sp, NOW)).toEqual({ fy: "2025-26", tab: "Payment", q: "cash", page: 2 });
  });
});

describe("glRange", () => {
  it("computes the visible range and page count", () => {
    expect(glRange(1, GL_PAGE_SIZE, 60)).toEqual({ from: 1, to: 25, pages: 3 });
    expect(glRange(3, GL_PAGE_SIZE, 60)).toEqual({ from: 51, to: 60, pages: 3 });
    expect(glRange(1, GL_PAGE_SIZE, 0)).toEqual({ from: 0, to: 0, pages: 1 });
  });
});
