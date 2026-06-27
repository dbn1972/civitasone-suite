import { PageHeader, StatGrid, StatCard, Card, StatusPill } from "@/app/_components/ds";

type WbsNode = {
  id: string;
  name: string;
  status: string;
  children?: WbsNode[];
};

const wbsTree: WbsNode[] = [
  {
    id: "PH-1",
    name: "Phase 1: Planning & Design",
    status: "completed",
    children: [
      {
        id: "ST-1.1",
        name: "Feasibility Study",
        status: "completed",
        children: [
          { id: "ACT-1.1.1", name: "Site survey and soil testing", status: "completed" },
          { id: "ACT-1.1.2", name: "Traffic impact assessment", status: "completed" },
          { id: "ACT-1.1.3", name: "Environmental clearance application", status: "completed" },
        ],
      },
      {
        id: "ST-1.2",
        name: "Detailed Engineering Design",
        status: "completed",
        children: [
          { id: "ACT-1.2.1", name: "Structural design and drawings", status: "completed" },
          { id: "ACT-1.2.2", name: "BOQ preparation", status: "completed" },
        ],
      },
    ],
  },
  {
    id: "PH-2",
    name: "Phase 2: Procurement",
    status: "completed",
    children: [
      {
        id: "ST-2.1",
        name: "Tender Process",
        status: "completed",
        children: [
          { id: "ACT-2.1.1", name: "NIT publication", status: "completed" },
          { id: "ACT-2.1.2", name: "Technical bid evaluation", status: "completed" },
          { id: "ACT-2.1.3", name: "Financial bid opening and LOA", status: "completed" },
        ],
      },
    ],
  },
  {
    id: "PH-3",
    name: "Phase 3: Construction",
    status: "in progress",
    children: [
      {
        id: "ST-3.1",
        name: "Foundation & Substructure",
        status: "completed",
        children: [
          { id: "ACT-3.1.1", name: "Piling works", status: "completed" },
          { id: "ACT-3.1.2", name: "Pile cap and pier construction", status: "completed" },
        ],
      },
      {
        id: "ST-3.2",
        name: "Superstructure",
        status: "in progress",
        children: [
          { id: "ACT-3.2.1", name: "Girder casting and launching", status: "in progress" },
          { id: "ACT-3.2.2", name: "Deck slab construction", status: "pending" },
          { id: "ACT-3.2.3", name: "Wearing coat and railing", status: "pending" },
        ],
      },
      {
        id: "ST-3.3",
        name: "Approach Roads",
        status: "pending",
        children: [
          { id: "ACT-3.3.1", name: "Earthwork and formation", status: "pending" },
          { id: "ACT-3.3.2", name: "Pavement layers (GSB/WMM/DBM/BC)", status: "pending" },
        ],
      },
    ],
  },
  {
    id: "PH-4",
    name: "Phase 4: Testing & Handover",
    status: "pending",
    children: [
      {
        id: "ST-4.1",
        name: "Quality Assurance",
        status: "pending",
        children: [
          { id: "ACT-4.1.1", name: "Load testing of bridge", status: "pending" },
          { id: "ACT-4.1.2", name: "Third-party quality audit", status: "pending" },
        ],
      },
      {
        id: "ST-4.2",
        name: "Commissioning",
        status: "pending",
        children: [
          { id: "ACT-4.2.1", name: "Deficiency rectification", status: "pending" },
          { id: "ACT-4.2.2", name: "Final handover to PWD", status: "pending" },
        ],
      },
    ],
  },
];

function countActivities(nodes: WbsNode[]): { total: number; completed: number; inProgress: number; notStarted: number } {
  let total = 0;
  let completed = 0;
  let inProgress = 0;
  let notStarted = 0;
  for (const node of nodes) {
    if (!node.children) {
      total++;
      if (node.status === "completed") completed++;
      else if (node.status === "in progress") inProgress++;
      else notStarted++;
    }
    if (node.children) {
      const sub = countActivities(node.children);
      total += sub.total;
      completed += sub.completed;
      inProgress += sub.inProgress;
      notStarted += sub.notStarted;
    }
  }
  return { total, completed, inProgress, notStarted };
}

function WbsTreeNode({ node, depth }: { node: WbsNode; depth: number }) {
  const isLeaf = !node.children;
  return (
    <>
      <li
        role="treeitem"
        aria-expanded={node.children ? true : undefined}
        style={{
          paddingLeft: depth * 24 + 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: `8px 12px 8px ${depth * 24 + 12}px`,
          borderBottom: "1px solid var(--border, #e2e8f0)",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 14, width: 20, textAlign: "center" }}>
          {isLeaf ? "📄" : depth === 0 ? "📦" : "📂"}
        </span>
        <span style={{ flex: 1, fontWeight: depth === 0 ? 600 : depth === 1 ? 500 : 400, fontSize: 14 }}>
          <span style={{ color: "var(--muted)", marginRight: 6, fontSize: 12 }}>{node.id}</span>
          {node.name}
        </span>
        <StatusPill status={node.status} />
      </li>
      {node.children &&
        node.children.map((child) => (
          <WbsTreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
    </>
  );
}

export default function WbsPage() {
  const stats = countActivities(wbsTree);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Work Breakdown Structure" subtitle="Hierarchical view of project phases, stages and activities — NH-44 Bypass Construction." back="/projects" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Activities" value={stats.total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Completed" value={stats.completed} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={stats.inProgress} />
        <StatCard icon="⏳" iconBg="#f1f5f9" label="Not Started" value={stats.notStarted} />
      </StatGrid>
      <Card title="WBS Hierarchy" padding>
        <ul role="tree" aria-label="Work breakdown structure" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {wbsTree.map((node) => (
            <WbsTreeNode key={node.id} node={node} depth={0} />
          ))}
        </ul>
      </Card>
    </main>
  );
}
