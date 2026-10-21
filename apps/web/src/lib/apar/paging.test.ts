import { describe, it, expect } from "vitest";
import { APAR_PAGE_SIZE, offsetForPage, pageWindow, parsePage } from "./paging";

describe("APAR list paging helpers (GAP-HR-APAR-06)", () => {
  it("parses ?page= to a 1-based page and treats anything invalid as page 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage("")).toBe(1);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("-4")).toBe(1);
    expect(parsePage("2.5")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage("1; DROP TABLE")).toBe(1);
    expect(parsePage(["2"])).toBe(1);
  });

  it("caps an absurd page number", () => {
    expect(parsePage("999999")).toBe(10_000);
  });

  it("turns a page into an offset in whole pages", () => {
    expect(APAR_PAGE_SIZE).toBe(20);
    expect(offsetForPage(1)).toBe(0);
    expect(offsetForPage(2)).toBe(20);
    expect(offsetForPage(8)).toBe(140);
  });

  it("150 records: first page shows 1-20 with only a next page", () => {
    expect(pageWindow(150, 0, 20)).toEqual({ from: 1, to: 20, prevPage: null, nextPage: 2 });
  });

  it("150 records: a middle page has both neighbours", () => {
    expect(pageWindow(150, 40, 20)).toEqual({ from: 41, to: 60, prevPage: 2, nextPage: 4 });
  });

  it("150 records: the last, partial page 141-150 has no next page", () => {
    expect(pageWindow(150, 140, 10)).toEqual({ from: 141, to: 150, prevPage: 7, nextPage: null });
  });

  it("an exact multiple does not offer an empty trailing page", () => {
    expect(pageWindow(40, 20, 20)).toEqual({ from: 21, to: 40, prevPage: 1, nextPage: null });
  });

  it("a page past the end shows nothing but still offers the way back", () => {
    expect(pageWindow(150, 400, 0)).toEqual({ from: 0, to: 400, prevPage: 20, nextPage: null });
  });
});
