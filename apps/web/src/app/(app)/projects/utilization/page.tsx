import { PageHeader, StatGrid, StatCard, Card, EmptyState } from "@/app/_components/ds";
import { UtilizationTable, type UtilizationRow } from "./UtilizationTable";
import { deriveUtilizationTotals } from "./utilizationTotals";
import { formatCrore, formatPercent } from "@/lib/formatters";

// GAP-PROJECTS-UTILIZATION-01 (HIGH, fabricated data): this page used to
// hard-code eight sample projects (Lucknow, Dehradun, Jaipur, Patna…) and four
// hand-typed stat tiles with NO loader call at all, so a Government user read
// fabricated fund positions as their department's own. The literals are
// removed. project-service exposes no project-wide fund-utilization aggregate
// endpoint today (only per-scheme UC statements under
// services/project-service/src/modules/utilisation), so rather than invent an
// endpoint-and-migration we cannot verify end to end tonight, the page shows an
// honest "not available yet" state and never any sample numbers.
//
// GAP-PROJECTS-UTILIZATION-02: when rows DO arrive, every tile is DERIVED from
// the rows in BigInt minor units (deriveUtilizationTotals), and "Utilization %"
// is the weighted sum(utilised)/sum(allocated) its "of allocated" label claims
// — not the unweighted mean of per-row percentages the old static tile showed.
//
// HUMAN REVIEW (money): wiring a real getProjectUtilization() loader + a
// project-service aggregation endpoint (allocated/released/utilised per project
// as minor-unit strings) is the follow-up to make this page live. It is left as
// a reviewed decision because it needs the DB-backed service test suite (test
// Postgres on :5672), which was unavailable during this run.
const rows: UtilizationRow[] = [];

export default function UtilizationPage() {
  const totals = deriveUtilizationTotals(rows);
  const hasData = rows.length > 0;

  return (
    <div className="page-main wrap">
      <PageHeader title="Fund Utilization" subtitle="Track allocation, releases and utilization across all projects." back="/projects" />
      <StatGrid>
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocated" value={hasData ? formatCrore(totals.allocatedMinor) : "—"} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Utilized" value={hasData ? formatCrore(totals.utilisedMinor) : "—"} />
        <StatCard icon="📈" iconBg="#fffaeb" label="Utilization % (of allocated)" value={hasData ? formatPercent(totals.utilisationPct) : "—"} />
        <StatCard icon="🏦" iconBg="#f1f5f9" label="Unspent Balance" value={hasData ? formatCrore(totals.unspentMinor) : "—"} />
      </StatGrid>
      <Card title="Project-wise Utilization">
        {hasData ? (
          <UtilizationTable rows={rows} />
        ) : (
          <EmptyState
            icon="📊"
            title="Fund utilization not available yet"
            message="Project-wise fund utilization is not available for this tenant yet. Once utilization is recorded against projects, allocation, releases and utilization will appear here."
          />
        )}
      </Card>
    </div>
  );
}
