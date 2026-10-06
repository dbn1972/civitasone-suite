import type { OrgHierarchyNode } from "@/app/_data/loaders";

/**
 * GAP-TENANT-ADMIN-ORG-HIERARCHY-02: headCount is a per-node DIRECT count, so
 * summing it across every level is the correct whole-org total — NOT a
 * double-count of rolled-up parent figures (the tenant-service org_units
 * contract carries no rolled-up totals). Returns null when the backend provided
 * NO counts at all (every node's headCount absent), so the "Total Staff" tile
 * renders "—" instead of a fabricated 0 / NaN.
 */
export function countAllStaff(nodes: OrgHierarchyNode[]): number | null {
  let total = 0;
  let anyPresent = false;
  const walk = (list: OrgHierarchyNode[]): void => {
    for (const node of list) {
      if (typeof node.headCount === "number") {
        total += node.headCount;
        anyPresent = true;
      }
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return anyPresent ? total : null;
}
