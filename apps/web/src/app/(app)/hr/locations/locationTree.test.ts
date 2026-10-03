import { describe, it, expect } from "vitest";
import { descendantIds, selectableParents, buildLocationPatch } from "./locationTree";

const ROWS = [
  { id: "S", parentId: null, status: "active" },
  { id: "D", parentId: "S", status: "active" },
  { id: "B", parentId: "D", status: "active" },
  { id: "O", parentId: null, status: "active" },
  { id: "X", parentId: "O", status: "archived" },
];

describe("descendantIds", () => {
  it("finds every level below a node, not the node or its siblings", () => {
    expect([...descendantIds(ROWS, "S")].sort()).toEqual(["B", "D"]);
    expect([...descendantIds(ROWS, "B")]).toEqual([]);
  });
  it("survives a corrupt parent cycle", () => {
    const loop = [{ id: "a", parentId: "b" }, { id: "b", parentId: "a" }];
    expect([...descendantIds(loop, "a")]).toEqual(["b"]);
  });
});

describe("selectableParents", () => {
  it("never offers the location itself, a descendant (a cycle), or an archived location", () => {
    expect(selectableParents(ROWS, "S").map((r) => r.id)).toEqual(["O"]);
    expect(selectableParents(ROWS, "D").map((r) => r.id).sort()).toEqual(["O", "S"]);
  });
});

describe("buildLocationPatch", () => {
  const base = { name: "HQ", type: "office", parentId: "S", addressLine: "1 Main", city: "Delhi", postalCode: "110001", lgdCode: null };
  it("is empty when nothing changed (blank == null)", () => {
    expect(buildLocationPatch(base, { ...base, lgdCode: "" })).toEqual({});
  });
  it("sends only what changed, and null to clear an optional field or the parent", () => {
    expect(buildLocationPatch(base, { ...base, postalCode: "110002", city: "", parentId: null })).toEqual({ postalCode: "110002", city: null, parentId: null });
  });
});
