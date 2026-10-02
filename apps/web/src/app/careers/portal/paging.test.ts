import { describe, it, expect } from "vitest";
import { MAX_PAGE, clampPage, pageRedirectTarget } from "./paging";

describe("portal paging", () => {
  it("clampPage bounds huge, zero and junk values", () => {
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage("abc")).toBe(1);
    expect(clampPage("0")).toBe(1);
    expect(clampPage("99999999999999")).toBe(MAX_PAGE);
    expect(clampPage("3")).toBe(3);
  });
  it("redirects past-the-end pages to the last page", () => {
    expect(pageRedirectTarget({ kind: "ok", applications: [], total: 45 }, 9)).toBe("/careers/portal?page=3");
  });
  it("never redirects page 1, a non-empty page, an empty account or a failed fetch", () => {
    expect(pageRedirectTarget({ kind: "ok", applications: [], total: 45 }, 1)).toBeNull();
    expect(pageRedirectTarget({ kind: "ok", applications: [{}], total: 45 }, 2)).toBeNull();
    expect(pageRedirectTarget({ kind: "ok", applications: [], total: 0 }, 4)).toBeNull();
    expect(pageRedirectTarget({ kind: "error" }, 4)).toBeNull();
  });
});
