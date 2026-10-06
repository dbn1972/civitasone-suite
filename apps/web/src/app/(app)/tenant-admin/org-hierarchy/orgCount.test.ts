import { describe, it, expect } from "vitest";
import { countAllStaff } from "./orgCount";
import type { OrgHierarchyNode } from "@/app/_data/loaders";

describe("countAllStaff — GAP-TENANT-ADMIN-ORG-HIERARCHY-02", () => {
  it("sums per-node DIRECT counts across every level (parent + children, no double-count)", () => {
    const tree: OrgHierarchyNode[] = [
      {
        id: "root", name: "HQ", headCount: 5,
        children: [
          { id: "a", name: "Finance", headCount: 10 },
          { id: "b", name: "HR", headCount: 7, children: [{ id: "b1", name: "Payroll", headCount: 3 }] },
        ],
      },
    ];
    // 5 + 10 + 7 + 3 = 25. A rolled-up-parent model would wrongly report more.
    expect(countAllStaff(tree)).toBe(25);
  });

  it("returns null (-> '—' tile) when NO node carries a headCount, instead of a fabricated 0", () => {
    const tree = [
      { id: "root", name: "HQ", children: [{ id: "a", name: "Finance" }] },
    ] as unknown as OrgHierarchyNode[];
    expect(countAllStaff(tree)).toBeNull();
  });

  it("counts the present nodes and ignores absent ones (never NaN)", () => {
    const tree = [
      { id: "root", name: "HQ", headCount: 4, children: [{ id: "a", name: "Finance" }] },
    ] as unknown as OrgHierarchyNode[];
    expect(countAllStaff(tree)).toBe(4);
  });
});
