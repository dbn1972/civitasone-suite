import { describe, it, expect } from "vitest";
import { placeHeadsAsTree } from "./headTree";

const h = (id: string, code: string, parentId: string | null = null, level?: number) => ({ id, code, name: `Head ${code}`, parentId, ...(level === undefined ? {} : { level }) });

describe("placeHeadsAsTree (GAP-FINANCE-CHART-OF-ACCOUNTS-NEW-02)", () => {
  it("puts each head directly under its parent, siblings by code, with its depth", () => {
    const placed = placeHeadsAsTree([
      h("s1", "2100-01", "m1", 2),
      h("a", "3000", null, 0),
      h("m1", "2100", "g", 1),
      h("g", "2000", null, 0),
      h("m2", "2200", "g", 1),
    ]);
    expect(placed.map((p) => [p.head.code, p.depth])).toEqual([
      ["2000", 0], ["2100", 1], ["2100-01", 2], ["2200", 1], ["3000", 0],
    ]);
  });

  it("names the parent of every non-major head", () => {
    const placed = placeHeadsAsTree([h("g", "2000", null, 0), h("m1", "2100", "g", 1)]);
    expect(placed[0]).toMatchObject({ parent: null, parentMissing: false });
    expect(placed[1]).toMatchObject({ parent: { code: "2000", name: "Head 2000" }, parentMissing: false });
  });

  it("orders codes numerically-aware (2 before 10)", () => {
    expect(placeHeadsAsTree([h("b", "10"), h("a", "2")]).map((p) => p.head.code)).toEqual(["2", "10"]);
  });

  it("a head whose parent is not in the list is kept, flagged, and indented by its own level (not shown as a major head)", () => {
    const placed = placeHeadsAsTree([h("m1", "2100", "gone", 1), h("c", "2101", "m1", 2)]);
    expect(placed.map((p) => [p.head.code, p.depth, p.parentMissing])).toEqual([["2100", 1, true], ["2101", 2, false]]);
  });

  it("never loses or loops on bad data: a parent cycle and a head that is its own parent are all listed once", () => {
    const placed = placeHeadsAsTree([h("a", "A", "b"), h("b", "B", "a"), h("c", "C", "c"), h("d", "D", null)]);
    expect(placed.map((p) => p.head.code).sort()).toEqual(["A", "B", "C", "D"]);
    expect(new Set(placed.map((p) => p.head)).size).toBe(4);
  });

  it("caps the indent at the third level", () => {
    const placed = placeHeadsAsTree([h("a", "1", null), h("b", "2", "a"), h("c", "3", "b"), h("d", "4", "c")]);
    expect(placed.map((p) => p.depth)).toEqual([0, 1, 2, 2]);
  });

  it("an empty chart is an empty list", () => {
    expect(placeHeadsAsTree([])).toEqual([]);
  });
});
