import { describe, it, expect } from "vitest";
import { PAGE_SIZE, detailHref, employeesQuery, pageWindow, panelState, parseDetailParams } from "./locationDetailView";

describe("parseDetailParams", () => {
  it("defaults to page 0, no search, no sub-locations, active status", () => {
    expect(parseDetailParams(undefined)).toEqual({ page: 0, q: "", includeSub: false, status: "active" });
  });
  it("reads page/q/sub/status and ignores an unknown status or negative page", () => {
    expect(parseDetailParams({ page: "2", q: "  asha ", sub: "1", status: "on_leave" })).toEqual({ page: 2, q: "asha", includeSub: true, status: "on_leave" });
    expect(parseDetailParams({ page: "-4", status: "bogus" })).toMatchObject({ page: 0, status: "active" });
  });
});

describe("detailHref / employeesQuery", () => {
  it("omits defaults and encodes values", () => {
    expect(detailHref("L1", {})).toBe("/hr/locations/L1");
    expect(detailHref("L1", { includeSub: true, q: "a b", status: "all", page: 3 })).toBe("/hr/locations/L1?sub=1&status=all&q=a%20b&page=3");
  });
  it("builds the API query with offset = page * size and the sub flag", () => {
    expect(employeesQuery({ page: 2, q: "x", includeSub: true, status: "active" })).toBe(
      `limit=${PAGE_SIZE}&offset=${2 * PAGE_SIZE}&status=active&includeSubLocations=true&q=x`,
    );
  });
});

describe("panelState", () => {
  it("never reads a failed load as empty", () => {
    expect(panelState("error", 0, false)).toBe("error");
    expect(panelState("error", 0, true)).toBe("error");
  });
  it("distinguishes genuinely empty, no-match under a filter, and rows", () => {
    expect(panelState("api", 0, false)).toBe("empty");
    expect(panelState("api", 0, true)).toBe("no-match");
    expect(panelState("api", 3, true)).toBe("rows");
  });
});

describe("pageWindow", () => {
  it("computes range and prev/next", () => {
    expect(pageWindow(60, 1)).toEqual({ from: 26, to: 50, hasPrev: true, hasNext: true, needsPaging: true });
    expect(pageWindow(60, 2)).toMatchObject({ from: 51, to: 60, hasNext: false });
    expect(pageWindow(10, 0)).toMatchObject({ needsPaging: false });
    expect(pageWindow(0, 0)).toMatchObject({ from: 0, to: 0 });
  });
});
