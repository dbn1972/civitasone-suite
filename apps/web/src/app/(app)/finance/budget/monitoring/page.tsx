import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceBudgetMonitoring, getFinanceBudgetMonitoringLines } from "@/app/_data/loaders";
import { MonitoringTable } from "./MonitoringTable";

function rupees(val: unknown): string {
  const n = Number(BigInt(String(val ?? "0"))) / 100;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toFixed(0)}`;
}

export default async function BudgetMonitoringPage() {
  const [{ data: summary, source }, { data: lines }] = await Promise.all([
    getFinanceBudgetMonitoring(),
    getFinanceBudgetMonitoringLines(),
  ]);

  const totals = (summary as Record<string, unknown> & { totals?: Record<string, unknown> })?.totals ?? {};
  const exceptions = (totals as Record<string, Record<string, number>>).exceptions ?? {};
  const overCommitted = exceptions.over_committed ?? 0;
  const underUtilised = exceptions.under_utilised ?? 0;
  const projOverspend = exceptions.projected_overspend ?? 0;
  const onTrack = (totals as Record<string, unknown>).count
    ? Number((totals as Record<string, unknown>).count) - overCommitted - underUtilised - projOverspend
    : 0;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Budget Monitoring"
        subtitle="Real-time head-wise allocation, commitment, expenditure and forecast."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="var(--panel)"
          label="Total Allocated"
          value={rupees((totals as Record<string, unknown>).allocatedMinor)}
        />
        <StatCard
          icon="📤"
          iconBg="var(--panel)"
          label="Total Expended"
          value={rupees((totals as Record<string, unknown>).actualMinor)}
        />
        <StatCard
          icon="🟢"
          iconBg="#ecfdf3"
          label="On Track"
          value={onTrack}
        />
        <StatCard
          icon="🔴"
          iconBg="#fef2f2"
          label="Exceptions"
          value={overCommitted + underUtilised + projOverspend}
          up={false}
        />
      </StatGrid>

      {/* Exception summary strip */}
      {(overCommitted + projOverspend + underUtilised) > 0 && (
        <div style={{
          display: "flex", gap: 12, padding: "12px 16px", marginBottom: 16,
          background: "var(--panel)", borderRadius: "var(--r)", border: "1px solid var(--line)",
        }}>
          {overCommitted > 0 && (
            <span style={{ color: "var(--bad)", fontSize: 13, fontWeight: 600 }}>
              ⛔ {overCommitted} over-committed
            </span>
          )}
          {projOverspend > 0 && (
            <span style={{ color: "var(--warn)", fontSize: 13, fontWeight: 600 }}>
              ⚠️ {projOverspend} projected overspend
            </span>
          )}
          {underUtilised > 0 && (
            <span style={{ color: "var(--ink2)", fontSize: 13, fontWeight: 600 }}>
              🔵 {underUtilised} under-utilised
            </span>
          )}
        </div>
      )}

      <Card title="Head-wise Budget vs Expenditure">
        <MonitoringTable lines={lines} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
