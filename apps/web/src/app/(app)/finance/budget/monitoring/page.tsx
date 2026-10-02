import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getFinanceBudgetMonitoring, getFinanceBudgetMonitoringLines } from "@/app/_data/loaders";
import { currentFinancialYear, isValidFinancialYearLabel } from "@/lib/fiscalYear";
import { formatMoneyCompact } from "@/lib/formatters";
import { FyFilter } from "../../_components/FyFilter";
import { MonitoringTable } from "./MonitoringTable";
import { exceptionCount, onTrackCount, type MonitoringTotals as Totals } from "../_lib/monitoringTotals";

export default async function BudgetMonitoringPage({
  searchParams,
}: {
  searchParams?: { fy?: string };
}) {
  // These endpoints REQUIRE ?fy= and return HTTP 400 without it, so the page
  // must resolve a concrete FY (honouring the FyFilter's ?fy=, else today's FY)
  // instead of calling the loaders bare — which always errored to empty zeros.
  const fy =
    // GAP-FINANCE-BUDGET-MONITORING-05: a malformed ?fy= falls back to the current FY.
    typeof searchParams?.fy === "string" && isValidFinancialYearLabel(searchParams.fy)
      ? searchParams.fy
      : currentFinancialYear();
  const [summaryRes, linesRes] = await Promise.all([
    getFinanceBudgetMonitoring(fy),
    getFinanceBudgetMonitoringLines(fy),
  ]);
  // GAP-FINANCE-BUDGET-MONITORING-01: the cards and the table come from two
  // independent fetches, so each now owns its own error state. Previously
  // only the SUMMARY's source reached the table: a failed lines fetch showed
  // "No budget allocation lines found for this FY." with no badge, and a
  // failed summary showed ₹0 cards above real rows.
  const summaryErr = summaryRes.source === "error";
  const linesErr = linesRes.source === "error";
  const summary = summaryRes.data;
  const lines = linesRes.data;

  const totals: Totals = (summary as { totals?: Totals } | null | undefined)?.totals ?? {};
  const exceptions = totals.exceptions ?? {};
  const overCommitted = exceptionCount(exceptions.over_committed);
  const underUtilised = exceptionCount(exceptions.under_utilised);
  const projOverspend = exceptionCount(exceptions.projected_overspend);
  const onTrack = onTrackCount(totals);
  // Stat cards use main's compact Cr/L form (exact below 1 lakh); the table below stays exact.
  const money = (v: unknown) => (summaryErr ? "—" : formatMoneyCompact(v as string | number | null | undefined));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Budget Monitoring"
        subtitle="Real-time head-wise allocation, commitment, expenditure and forecast."
        back="/finance"
        actions={
          <>
            <FyFilter />
          </>
        }
      />

      {summaryErr && (
        <div role="alert" style={{ marginBottom: 12 }}>
          <RefreshErrorState error={toHumanError("load", { area: "budget monitoring totals" })} />
        </div>
      )}
      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="var(--panel)"
          label="Total Allocated"
          value={money(totals.allocatedMinor)}
        />
        <StatCard
          icon="🧾"
          iconBg="var(--panel)"
          label="Total Committed"
          value={money(totals.committedMinor)}
        />
        <StatCard
          icon="📤"
          iconBg="var(--panel)"
          label="Total Expended"
          value={money(totals.actualMinor)}
        />
        <StatCard
          icon="🟢"
          iconBg="#ecfdf3"
          label="On Track"
          value={summaryErr || onTrack === null ? "—" : onTrack}
        />
        <StatCard
          icon="🔴"
          iconBg="#fef2f2"
          label="Exceptions"
          value={summaryErr ? "—" : overCommitted + underUtilised + projOverspend}
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

      {/* UX-012: the data-source badge now lives inside MonitoringTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <Card title="Head-wise Budget vs Expenditure">
        {linesErr ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "budget monitoring lines" })} backHref="/finance" />
          </div>
        ) : (
          <MonitoringTable lines={lines} source="api" />
        )}
      </Card>
    </div>
  );
}
