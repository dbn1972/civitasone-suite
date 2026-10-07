import Link from "next/link";
import { getMISSummary } from "../../../_data/loaders";
import { EmptyState, PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { parseChange } from "@/lib/trend";
import { MISMetricsTable, type MetricRow } from "./MISMetricsTable";

export default async function MISDashboardPage() {
  const { data: modules, source } = await getMISSummary();
  // GAP-REPORTS-MIS-01: on a fetch error `modules` is the empty fallback, so
  // every count below is 0. Showing "0 Data Sources / 0 Metrics" above the
  // error card reads as a real, confident result. Pass null (StatCard renders
  // "—") for every card and drop the delta copy when errored.
  const errored = source === "error";
  const isEmpty = !errored && modules.length === 0;

  const totalMetrics = modules.reduce((s, m) => s + m.metrics.length, 0);
  // GAP-REPORTS-MIS-02: classify trend via parseChange (handles unsigned,
  // Unicode-minus, "%" etc.) instead of a raw startsWith("+")/("-") check.
  const allMetrics = modules.flatMap((m) => m.metrics);
  const positiveTrends = allMetrics.filter((m) => parseChange(m.change) === "up").length;
  const negativeTrends = allMetrics.filter((m) => parseChange(m.change) === "down").length;

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
          // GAP-REPORTS-MIS-04: only offer "Build Report" when there is data to
          // build from — not on the empty or error states.
          !errored && !isEmpty ? (
            <Link href="/reports/list/new?reportType=mis" className="btn primary">Build Report</Link>
          ) : undefined
        }
      />

      <StatGrid>
        <StatCard icon="🗄️" iconBg="#e7f3fb" label="Data Sources" value={errored ? null : modules.length} delta={errored ? undefined : "modules"} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Total Metrics" value={errored ? null : totalMetrics} />
        <StatCard icon="⚡" iconBg="#ecfdf3" label="Positive Trends" value={errored ? null : positiveTrends} delta={errored ? undefined : "live"} up={positiveTrends > 0} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Negative Trends" value={errored ? null : negativeTrends} />
      </StatGrid>

      {errored ? (
        <div className="card" style={{ marginTop: "18px" }}>
          <div className="card-h"><h3>Cross-department datasets</h3></div>
          <RefreshErrorState error={toHumanError("load", { area: "MIS data" })} backHref="/reports" />
        </div>
      ) : isEmpty ? (
        // GAP-REPORTS-MIS-04: wrap the empty state in the same card + header as
        // the populated branch, instead of a bare EmptyState.
        <div className="card" style={{ marginTop: "18px" }}>
          <div className="card-h"><h3>Cross-department datasets</h3></div>
          <EmptyState icon="📊" title="MIS data compiling" message="Please check back shortly." />
        </div>
      ) : (
        <div className="card" style={{ marginTop: "18px" }}>
          <div className="card-h"><h3>Cross-department datasets</h3></div>
          <MISMetricsTable rows={rows} />
        </div>
      )}
    </div>
  );
}
