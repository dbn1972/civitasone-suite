import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, Card, StatGrid, StatCard } from "../../../_components/ds";
import { getOrgChart } from "../../../_data/loaders";
import type { OrgChartNode } from "@civitasone/types";
import { OrgChartClient } from "./OrgChartClient";

function countAll(nodes: OrgChartNode[]): number {
  return nodes.reduce(
    (sum, n) => sum + 1 + countAll((n.children ?? []) as OrgChartNode[]),
    0
  );
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
      <Card padding>
        <OrgChartClient data={nodes} />
      </Card>
    </main>
  );
}
