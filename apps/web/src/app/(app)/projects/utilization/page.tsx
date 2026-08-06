import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getProjectFundReleases } from "../../../_data/loaders";
import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { UtilizationTable, type UtilizationRow } from "./UtilizationTable";

/**
 * Fund Utilization — aggregated per project from the real fund-release
 * register. "Allocated" is every sanctioned/released/utilized release for the
 * project; "Released" excludes still-sanctioned amounts; "Utilized" is the
 * utilized bucket. On loader failure the page shows the error badge and an
 * empty state — it never fabricates numbers.
 */
export default async function UtilizationPage() {
  const { data: releases, source } = await getProjectFundReleases();

  const byProject = new Map<string, { project: string; allocated: number; released: number; utilized: number }>();
  for (const r of releases) {
    const agg = byProject.get(r.projectId) ?? { project: r.projectName, allocated: 0, released: 0, utilized: 0 };
    agg.allocated += r.amount;
    if (r.status === "released" || r.status === "utilized") agg.released += r.amount;
    if (r.status === "utilized") agg.utilized += r.amount;
    byProject.set(r.projectId, agg);
  }

  const rows: UtilizationRow[] = Array.from(byProject.values()).map((p) => ({
    project: p.project,
    allocated: formatMoney(p.allocated),
    released: formatMoney(p.released),
    utilized: formatMoney(p.utilized),
    // Guard: 0 released must render as "—", not Infinity/NaN.
    utilizationPct: p.released > 0 ? `${Math.round((p.utilized / p.released) * 100)}%` : "—",
    status: p.utilized > 0 ? "utilizing" : p.released > 0 ? "released" : "sanctioned",
  }));

  const totalAllocated = rows.length ? formatMoney(Array.from(byProject.values()).reduce((s, p) => s + p.allocated, 0)) : "—";
  const totalReleased = rows.length ? formatMoney(Array.from(byProject.values()).reduce((s, p) => s + p.released, 0)) : "—";
  const totalUtilized = rows.length ? formatMoney(Array.from(byProject.values()).reduce((s, p) => s + p.utilized, 0)) : "—";
  const sumReleased = Array.from(byProject.values()).reduce((s, p) => s + p.released, 0);
  const sumUtilized = Array.from(byProject.values()).reduce((s, p) => s + p.utilized, 0);
  const avgUtilization = sumReleased > 0 ? `${Math.round((sumUtilized / sumReleased) * 100)}%` : "—";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Fund Utilization" subtitle="Track allocation, releases and utilization across all projects." back="/projects" />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocated" value={totalAllocated} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Utilized" value={totalUtilized} />
        <StatCard icon="📈" iconBg="#fffaeb" label="Utilization %" value={avgUtilization} />
        <StatCard icon="🏦" iconBg="#f1f5f9" label="Released" value={totalReleased} />
      </StatGrid>
      <Card title="Project-wise Utilization">
        {rows.length === 0 ? (
          <EmptyState icon="📊" title="No fund releases" message="Utilization appears here once funds are released to projects." />
        ) : (
          <UtilizationTable rows={rows} />
        )}
      </Card>
    </main>
  );
}
