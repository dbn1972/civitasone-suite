import Link from "next/link";
import { getMISSummary } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { MISMetricsTable, type MetricRow } from "./MISMetricsTable";

export default async function MISDashboardPage() {
  const { data: modules, source } = await getMISSummary();

  const totalMetrics = modules.reduce((s, m) => s + m.metrics.length, 0);
  const positiveTrends = modules.flatMap((m) => m.metrics).filter((m) => m.change?.startsWith("+")).length;
  const negativeTrends = modules.flatMap((m) => m.metrics).filter((m) => m.change?.startsWith("-")).length;

  const rows: MetricRow[] = modules.flatMap((mod) =>
    mod.metrics.map((m) => ({
      module: mod.module,
      label: m.label,
      value: String(m.value),
      unit: m.unit ?? "—",
      change: m.change ?? "—",
    }))
  );

  return (
    <div className="wrap">
      <PageHeader
        title="Management Information System"
        subtitle="Consolidated metrics across all modules."
        actions={
          <Link href="/reports/list/new?reportType=mis" className="btn primary">Build Report</Link>
        }
      />

      <StatGrid>
        <StatCard icon="🗄️" iconBg="#e7f3fb" label="Data Sources" value={modules.length} delta="modules" />
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Metrics" value={totalMetrics} />
        <StatCard icon="⚡" iconBg="#ecfdf3" label="Positive Trends" value={positiveTrends} delta="live" up={positiveTrends > 0} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Negative Trends" value={negativeTrends} />
      </StatGrid>

      {source === "error" ? (
        <div className="card" style={{ marginTop: "18px" }}>
          <div className="card-h"><h3>Cross-department datasets</h3></div>
          <RefreshErrorState error={toHumanError("load", { area: "MIS data" })} backHref="/reports" />
        </div>
      ) : modules.length === 0 ? (
        <EmptyState icon="📊" title="MIS data compiling" message="Please check back shortly." />
      ) : (
        <div className="card" style={{ marginTop: "18px" }}>
          <div className="card-h"><h3>Cross-department datasets</h3></div>
          <MISMetricsTable rows={rows} />
        </div>
      )}
    </div>
  );
}
