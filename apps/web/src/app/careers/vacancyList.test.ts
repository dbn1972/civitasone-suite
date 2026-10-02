import { describe, it, expect } from "vitest";
import { careersHref, matchesQuery, parsePage, sortByClosing, type ListVacancy } from "./vacancyList";

const v = (o: Partial<ListVacancy> & { id: string }): ListVacancy => ({ title: "T", vacancyType: "regular", ...o });

describe("vacancyList", () => {
  it("sorts closing-soonest first, no-deadline last, stable", () => {
    const out = sortByClosing([v({ id: "none" }), v({ id: "late", closesAt: "2026-12-01" }), v({ id: "soon", closesAt: "2026-11-01" }), v({ id: "none2" })]);
    expect(out.map((x) => x.id)).toEqual(["soon", "late", "none", "none2"]);
  });
  it("search matches title, ref, location and qualification case-insensitively", () => {
    expect(matchesQuery(v({ id: "1", title: "Junior Clerk" }), "clerk")).toBe(true);
    expect(matchesQuery(v({ id: "2", title: "Engineer", location: "Bhubaneswar" }), "BHUBAN")).toBe(true);
    expect(matchesQuery(v({ id: "3", title: "Engineer" }), "clerk")).toBe(false);
    expect(matchesQuery(v({ id: "4" }), "  ")).toBe(true);
  });
  it("parsePage clamps to [1, pageCount]", () => {
    expect(parsePage(undefined, 3)).toBe(1);
    expect(parsePage("0", 3)).toBe(1);
    expect(parsePage("abc", 3)).toBe(1);
    expect(parsePage("9", 3)).toBe(3);
    expect(parsePage("2", 3)).toBe(2);
  });
  it("careersHref keeps type and query, drops page 1", () => {
    expect(careersHref({})).toBe("/careers");
    expect(careersHref({ type: "deputation" })).toBe("/careers?type=deputation");
    expect(careersHref({ type: "regular", q: "clerk", page: 2 })).toBe("/careers?type=regular&q=clerk&page=2");
    expect(careersHref({ q: "a b" })).toBe("/careers?q=a+b");
  });
});
