import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getOrgHierarchy, type OrgHierarchyNode } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";

// GAP-TENANT-ADMIN-ORG-HIERARCHY-02: headCount is a per-node DIRECT count, so
// summing it across every level is the correct whole-org total — NOT a
// double-count of rolled-up parent figures (the backend contract carries no
// rolled-up totals; see loaders.ts OrgHierarchyNode). Returns null when the
// backend provided no counts at all, so the tile shows "—" instead of a
// fabricated 0.
function countAll(nodes: OrgHierarchyNode[]): number | null {
  let total = 0;
  let anyPresent = false;
  const walk = (list: OrgHierarchyNode[]): void => {
    for (const node of list) {
      if (typeof node.headCount === "number") { total += node.headCount; anyPresent = true; }
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return anyPresent ? total : null;
}

// GAP-TENANT-ADMIN-ORG-HIERARCHY-04: counts every unit INCLUDING the root. The
// stat card is labelled "Units" (not "Departments") so this all-node count
// matches what it claims — the root org is a unit too, and it is also shown as
// "Root Org", so calling the whole count "Departments" was misleading.
function countUnits(nodes: OrgHierarchyNode[]): number {
  let total = nodes.length;
  for (const node of nodes) {
    if (node.children) total += countUnits(node.children);
  }
  return total;
}

function maxDepth(nodes: OrgHierarchyNode[], depth = 1): number {
  let max = depth;
  for (const node of nodes) {
    if (node.children) {
      const childDepth = maxDepth(node.children, depth + 1);
      if (childDepth > max) max = childDepth;
    }
  }
  return max;
}

// GAP-TENANT-ADMIN-ORG-HIERARCHY-01: render a plain nested <ul><li> list. The
// previous version put role="tree"/"treeitem" + aria-expanded on non-focusable,
// non-collapsible <li>s rendered as flat siblings — advertising a keyboard tree
// contract that did not exist and misleading screen-reader users. A nested list
// gives correct depth/level semantics with no false interactivity, and the
// redundant physical left padding (overridden by the padding shorthand) is gone.
function TreeNode({ node }: { node: OrgHierarchyNode }) {
  return (
    <li style={{ listStyle: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border, #e2e8f0)" }}>
        <span aria-hidden="true" style={{ fontSize: 14, width: 20, textAlign: "center" }}>{node.children && node.children.length > 0 ? "📂" : "📄"}</span>
        <span style={{ flex: 1, fontWeight: 400, fontSize: 14 }}>{node.name}</span>
        {typeof node.headCount === "number" && (
          <span className="pill info" style={{ fontSize: 11 }}>{node.headCount} staff</span>
        )}
      </div>
      {node.children && node.children.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, paddingInlineStart: 24 }}>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function OrgHierarchyPage() {
  const result = await getOrgHierarchy();
  const { data: orgTree, source } = result;
  const errored = toResourceState(result).status === "error";
  const totalUnits = errored ? 0 : countUnits(orgTree);
  const totalStaff = errored ? null : countAll(orgTree);
  const levels = errored ? 0 : maxDepth(orgTree);
  const rootName = orgTree.length > 0 ? orgTree[0].name : "—";

  // GAP-TENANT-ADMIN-ORG-HIERARCHY-03: give admins a way to act on what they
  // see. /admin/org admits tenant_admin+ (ADMIN_TENANT_ROLES); the hierarchy-
  // levels taxonomy on platform-admin/org-config is platform-only, so that link
  // is shown only to those roles.
  const roles = getSessionRoles();
  const canSeeLevels = hasAnyRole(roles, ["platform_admin", "super_admin"]);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Organization Hierarchy" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Organization Hierarchy"
        subtitle="View your department structure and employee distribution across organizational units."
        actions={
          <>
            <a href="/admin/org" className="btn primary" style={{ minHeight: 44 }}>Manage units</a>
            <a href="/tenant-admin/org-type" className="btn ghost" style={{ minHeight: 44 }}>Organisation type</a>
            {canSeeLevels && <a href="/platform-admin/org-config" className="btn ghost" style={{ minHeight: 44 }}>Hierarchy levels</a>}
          </>
        }
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Units" value={errored ? "—" : totalUnits} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Staff" value={errored || totalStaff === null ? "—" : totalStaff} />
        <StatCard icon="📊" iconBg="#f1f5f9" label="Levels" value={errored ? "—" : levels} />
        <StatCard icon="🌳" iconBg="#ecfdf3" label="Root Org" value={errored ? "—" : rootName} />
      </StatGrid>

      {errored ? (
        <Card title="Department Tree" padding>
          <RefreshErrorState error={toHumanError("load", { area: "organization hierarchy" })} backHref="/tenant-admin" />
        </Card>
      ) : orgTree.length === 0 ? (
        <Card title="Department Tree" padding>
          <EmptyState icon="🏛️" title="No organisation hierarchy configured" message="Set up your department structure to see it here." />
        </Card>
      ) : (
        <Card title="Department Tree" padding>
          <ul aria-label="Organization hierarchy" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {orgTree.map((node) => (
              <TreeNode key={node.id} node={node} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
