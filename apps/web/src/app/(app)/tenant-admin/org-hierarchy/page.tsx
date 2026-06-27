import { PageHeader, StatCard, StatGrid, Card } from "@/app/_components/ds";
import { Breadcrumb } from "../Breadcrumb";

type OrgNode = {
  id: string;
  name: string;
  headCount: number;
  children?: OrgNode[];
};

const orgTree: OrgNode[] = [
  {
    id: "dept-001",
    name: "Chief Secretary Office",
    headCount: 12,
    children: [
      {
        id: "dept-002",
        name: "Finance Department",
        headCount: 45,
        children: [
          { id: "dept-003", name: "Budget Division", headCount: 18 },
          { id: "dept-004", name: "Accounts Division", headCount: 15 },
          { id: "dept-005", name: "Treasury", headCount: 12 },
        ],
      },
      {
        id: "dept-006",
        name: "Human Resources",
        headCount: 32,
        children: [
          { id: "dept-007", name: "Recruitment Cell", headCount: 8 },
          { id: "dept-008", name: "Training & Development", headCount: 10 },
          { id: "dept-009", name: "Payroll", headCount: 14 },
        ],
      },
      {
        id: "dept-010",
        name: "Information Technology",
        headCount: 28,
        children: [
          { id: "dept-011", name: "Infrastructure", headCount: 10 },
          { id: "dept-012", name: "Applications", headCount: 12 },
          { id: "dept-013", name: "Cybersecurity", headCount: 6 },
        ],
      },
      {
        id: "dept-014",
        name: "Legal & Compliance",
        headCount: 15,
      },
      {
        id: "dept-015",
        name: "Procurement",
        headCount: 22,
        children: [
          { id: "dept-016", name: "Vendor Management", headCount: 8 },
          { id: "dept-017", name: "Contract Administration", headCount: 14 },
        ],
      },
    ],
  },
];

function countAll(nodes: OrgNode[]): number {
  let total = 0;
  for (const node of nodes) {
    total += node.headCount;
    if (node.children) total += countAll(node.children);
  }
  return total;
}

function TreeNode({ node, depth }: { node: OrgNode; depth: number }) {
  return (
    <>
      <li
        role="treeitem"
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

export default function OrgHierarchyPage() {
  const totalDepts = 17;
  const totalStaff = countAll(orgTree);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <Breadcrumb items={[{ label: "Tenant Admin", href: "/tenant-admin" }, { label: "Organization Hierarchy" }]} />
      <PageHeader
        back="/tenant-admin"
        title="Organization Hierarchy"
        subtitle="Department structure and employee distribution across organizational units."
      />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#eff6ff" label="Departments" value={totalDepts} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Staff" value={totalStaff} />
        <StatCard icon="📊" iconBg="#f1f5f9" label="Levels" value={3} />
        <StatCard icon="🌳" iconBg="#ecfdf3" label="Root Org" value="Chief Secretary" />
      </StatGrid>
      <Card title="Department Tree" padding>
        <ul role="tree" aria-label="Organization hierarchy" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {orgTree.map((node) => (
            <TreeNode key={node.id} node={node} depth={0} />
          ))}
        </ul>
      </Card>
    </main>
  );
}
