import { PageHeader, StatCard, StatGrid, Card, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { Breadcrumb } from "../Breadcrumb";
import { getOrgHierarchy, type OrgHierarchyNode } from "@/app/_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";

function countAll(nodes: OrgHierarchyNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += node.headCount;
    if (node.children) total += countAll(node.children);
  }
  return total;
}

function countDepts(nodes: OrgHierarchyNode[]): number {
  let total = nodes.length;
  for (const node of nodes) {
    if (node.children) total += countDepts(node.children);
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

function TreeNode({ node, depth }: { node: OrgHierarchyNode; depth: number }) {
  return (
    <>
      <li
        role="treeitem"
        aria-selected={false}
        aria-expanded={node.children ? true : undefined}
        style={{ paddingLeft: depth * 24, display: "flex", alignItems: "center", gap: 8, padding: `8px 12px 8px ${depth * 24 + 12}px`, borderBottom: "1px solid var(--border, #e2e8f0)" }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, width: 20, textAlign: "center" }}>{node.children ? "📂" : "📄"}</span>
        <span style={{ flex: 1, fontWeight: depth === 0 ? 600 : 400, fontSize: 14 }}>{node.name}</span>
        <span className="pill info" style={{ fontSize: 11 }}>{node.headCount} staff</span>
      </li>
      {node.children && node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default async function OrgHierarchyPage() {
  const result = await getOrgHierarchy();
  const { data: orgTree, source } = result;
  const errored = toResourceState(result).status === "error";
  const totalDepts = errored ? 0 : countDepts(orgTree);
  const totalStaff = errored ? 0 : countAll(orgTree);
  const levels = errored ? 0 : maxDepth(orgTree);
  const rootName = orgTree.length > 0 ? orgTree[0].name : "—";

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Organization Hierarchy" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Organization Hierarchy"
        subtitle="Department structure and employee distribution across organizational units."
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Departments" value={errored ? "—" : totalDepts} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Staff" value={errored ? "—" : totalStaff} />
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
          <ul role="tree" aria-label="Organization hierarchy" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {orgTree.map((node) => (
              <TreeNode key={node.id} node={node} depth={0} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
