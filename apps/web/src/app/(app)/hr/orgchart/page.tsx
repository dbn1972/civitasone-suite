import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, StatGrid, StatCard } from "../../../_components/ds";
import { getOrgChart } from "../../../_data/loaders";
import type { OrgChartNode } from "@civitasone/types";

function OrgNodeCard({ node }: { node: OrgChartNode }) {
  return (
    <div className="fields">
      <div className="field">
        <span className="lbl">Name</span>
        <span className="val">{node.name}</span>
      </div>
      <div className="field">
        <span className="lbl">Designation</span>
        <span className="val">{node.designation}</span>
      </div>
      <div className="field">
        <span className="lbl">Department</span>
        <span className="val">{node.department}</span>
      </div>
      {node.reportsTo && (
        <div className="field">
          <span className="lbl">Reports To</span>
          <span className="val">{node.reportsTo}</span>
        </div>
      )}
    </div>
  );
}


function countAll(nodes: OrgChartNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countAll((n.children ?? []) as OrgChartNode[]), 0);
}

export default async function OrgChartPage() {
  const { data: nodes, source } = await getOrgChart();

  const managers    = nodes.filter((n) => n.children && n.children.length > 0).length;
  const uniqueDepts = new Set(nodes.map((n) => n.department)).size;
  const roots       = nodes.filter((n) => !n.reportsTo).length;
  const totalCount  = countAll(nodes);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Organisation Chart"
        subtitle="Reporting hierarchy across departments." back="/hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label="Total Employees"    value={totalCount} />
        <StatCard icon="📋" iconBg="#e6f7f0" label="Departments"        value={uniqueDepts} />
        <StatCard icon="💼" iconBg="#fff7e6" label="Managers"           value={managers} />
        <StatCard icon="🌟" iconBg="#f5f5f5" label="Root / Heads"       value={roots} />
      </StatGrid>
      {nodes.length === 0 ? (
        <Card padding>
          <p className="text-center text-slate-400">No organisation chart data available.</p>
        </Card>
      ) : (
        <div className="grid g-4">
          {nodes.map((node) => (
            <Card key={node.id} title={node.name} padding>
              <OrgNodeCard node={node} />
              {node.children && node.children.length > 0 && (
                <div style={{ marginTop: "1rem" }}>
                  <p className="lbl" style={{ marginBottom: "0.5rem" }}>Direct Reports</p>
                  <div className="grid g-4">
                    {node.children.map((child) => (
                      <Card key={child.id} title={child.name} padding>
                        <OrgNodeCard node={child} />
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
