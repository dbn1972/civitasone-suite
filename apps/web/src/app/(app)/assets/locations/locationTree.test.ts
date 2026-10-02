import { describe, it, expect } from "vitest";
import { buildLocationTree, fetchAllLocations, flattenTree, hasDuplicateCode, orgUnitNames, type Location } from "./locationTree";

const L = (id: string, code: string, parentId?: string): Location => ({ id, code, name: `Name ${code}`, parentId: parentId ?? null });

describe("locationTree", () => {
  it("nests children under their parent (GAP-ASSETS-LOCATIONS-01)", () => {
    const tree = buildLocationTree([L("c", "B-1", "p"), L("p", "A"), L("g", "B-1-1", "c")]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.code).toBe("A");
    expect(tree[0]?.children[0]?.code).toBe("B-1");
    expect(tree[0]?.children[0]?.children[0]?.code).toBe("B-1-1");
    expect(flattenTree(tree).map((n) => [n.code, n.depth])).toEqual([["A", 0], ["B-1", 1], ["B-1-1", 2]]);
  });

  it("shows a row with an unknown parent as a root and survives a parent cycle", () => {
    expect(buildLocationTree([L("x", "X", "missing")]).map((n) => n.code)).toEqual(["X"]);
    const cyc = buildLocationTree([L("a", "A", "b"), L("b", "B", "a")]);
    expect(flattenTree(cyc)).toHaveLength(2);
  });

  it("detects duplicate codes case-insensitively, ignoring one id for edits (GAP-ASSETS-LOCATIONS-02)", () => {
    const rows = [L("1", "Bldg-A")];
    expect(hasDuplicateCode(rows, " bldg-a ")).toBe(true);
    expect(hasDuplicateCode(rows, "BLDG-B")).toBe(false);
    expect(hasDuplicateCode(rows, "bldg-a", "1")).toBe(false);
    expect(hasDuplicateCode(rows, "   ")).toBe(false);
  });

  it("lists org unit names, dropping blanks, dupes and names over the 64-char column (GAP-ASSETS-LOCATIONS-05)", () => {
    expect(orgUnitNames({ data: [{ name: "Works" }, { name: " Works " }, { name: "" }, { name: "x".repeat(65) }, { name: "Accounts" }] })).toEqual(["Accounts", "Works"]);
    expect(orgUnitNames("nope")).toEqual([]);
  });

  it("pages through every location, 100 at a time (GAP-ASSETS-LOCATIONS-04)", async () => {
    const calls: number[] = [];
    const all = await fetchAllLocations(async (offset, limit) => {
      calls.push(offset);
      const n = Math.max(0, Math.min(limit, 230 - offset));
      return Array.from({ length: n }, (_, i) => L(String(offset + i), `C${offset + i}`));
    });
    expect(all).toHaveLength(230);
    expect(calls).toEqual([0, 100, 200]);
  });

  it("returns null when a page fails", async () => {
    expect(await fetchAllLocations(async () => null)).toBeNull();
  });
});
