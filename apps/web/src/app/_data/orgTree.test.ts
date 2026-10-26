import { describe, it, expect } from "vitest";
import { buildOrgTree } from "./orgTree";

// GAP-TENANT-ORG-HIERARCHY-01: tenant-service GET /v1/org/hierarchy returns FLAT
// org_units ({ id, name, parentId }); the tree page needs nested children so a
// child unit renders indented under its parent.
describe("buildOrgTree", () => {
  it("nests flat rows by parentId (depth 0..n)", () => {
    const tree = buildOrgTree([
      { id: "c", name: "Section", parentId: "b" },
      { id: "a", name: "Directorate", parentId: null },
      { id: "b", name: "Division", parentId: "a" },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("a");
    expect(tree[0].children?.[0].id).toBe("b");
    expect(tree[0].children?.[0].children?.[0].id).toBe("c");
  });

  it("a row whose parent is absent becomes a root (never dropped)", () => {
    const tree = buildOrgTree([{ id: "x", name: "Orphan", parentId: "missing" }]);
    expect(tree.map((n) => n.id)).toEqual(["x"]);
  });

  it("leaves an already-nested payload untouched", () => {
    const nested = [{ id: "r", name: "Root", children: [{ id: "k", name: "Kid", children: [] }] }];
    expect(buildOrgTree(nested)).toEqual(nested);
  });

  it("a parent cycle cannot hang or drop units", () => {
    const tree = buildOrgTree([
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
    ]);
    const ids: string[] = [];
    const walk = (n: { id: string; children?: unknown[] }[]) => n.forEach((x) => { ids.push(x.id); walk((x.children ?? []) as never); });
    walk(tree);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("ignores non-object rows", () => {
    expect(buildOrgTree([null, 3, { id: "ok", name: "Ok" }] as unknown[]).map((n) => n.id)).toEqual(["ok"]);
  });
});
