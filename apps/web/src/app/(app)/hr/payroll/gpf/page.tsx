import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getGpfStatements } from "../../../../_data/loaders";
import { Chart } from "../../../../_components/Chart";

type GpfRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  period: string;
  contrib: number | string;
} & Record<string, unknown>;

// GPF earns interest at GoI-declared rate; currently 7.1% p.a. (as of Q1 FY 2026-27)
const GPF_INTEREST_RATE = 0.071;

function projectGpfCorpus(totalMinor: number, yearsRemaining: number): number {
  return totalMinor * Math.pow(1 + GPF_INTEREST_RATE, yearsRemaining);
}

export default async function GpfStatementsPage() {
  const { data: rows, source } = await getGpfStatements();

  const tableRows: GpfRow[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: r.employeeId.slice(0, 8).toUpperCase(),
    period: r.period,
    contrib: r.empContribMinor ?? 0,
  }));

  const uniqueEmps = new Set(tableRows.map((r) => r.employeeId)).size;
  const uniquePeriods = new Set(tableRows.map((r) => r.period)).size;
  const totalContrib = tableRows.reduce((s, r) => s + (Number(r.contrib) || 0), 0);

  const formatMoney = (minor: number) =>
    `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  // Period-wise trend
  const periodMap = new Map<string, number>();
  for (const r of tableRows) {
    periodMap.set(r.period, (periodMap.get(r.period) ?? 0) + (Number(r.contrib) || 0));
  }
  const sortedPeriods = Array.from(periodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6);
  const trendChartData = sortedPeriods.map(([label, value]) => ({
    label: label.slice(2),
    value: Math.round(value / 100),
  }));

  const AVG_YEARS_TO_RETIRE = 20;
  const projectedCorpus = projectGpfCorpus(totalContrib, AVG_YEARS_TO_RETIRE);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="GPF Statements"
        subtitle="General Provident Fund contributions — interest @ 7.1% p.a. (GoI Q1 FY 2026-27)."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Statements" value={tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label="Employees" value={uniqueEmps} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label="Total Contributions" value={formatMoney(totalContrib)} />
        <StatCard icon="📅" iconBg="var(--panel)" label="Periods" value={uniquePeriods} />
      </StatGrid>

      {/* GPF Corpus Dashboard */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          marginTop: 4,
        }}
      >
        <div
          style={{
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--fg2)", textTransform: "uppercase" }}>
            Accumulated Corpus
          </p>
          <p style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "var(--fg)" }}>
            {formatMoney(totalContrib)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--fg2)" }}>
            All employee GPF contributions (all periods)
          </p>
        </div>

        {sortedPeriods.length > 0 && (
          <div
            style={{
              background: "var(--panel)",
              border: "1px solid var(--line)",
              borderRadius: 12,
              padding: "18px 20px",
            }}
          >
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--fg2)", textTransform: "uppercase" }}>
              Last Period Contribution
            </p>
            <p style={{ margin: "0 0 2px", fontSize: 20, fontWeight: 700, color: "var(--fg)" }}>
              {formatMoney(sortedPeriods[sortedPeriods.length - 1][1])}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--fg2)" }}>
              Period: {sortedPeriods[sortedPeriods.length - 1][0]}
            </p>
          </div>
        )}

        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "#1e40af", textTransform: "uppercase" }}>
            Projected Value at Retirement
          </p>
          <p style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 800, color: "#1d4ed8" }}>
            {formatMoney(projectedCorpus)}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "#1e40af" }}>
            @7.1% p.a. over {AVG_YEARS_TO_RETIRE} yrs (compound). Illustrative only.
          </p>
        </div>
      </div>

      {trendChartData.length > 1 && (
        <Card title="Contribution Trend (last 6 periods, ₹)">
          <Chart type="line" data={trendChartData} height={180} />
        </Card>
      )}

      <Card title="GPF Ledger">
        {tableRows.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="No GPF statements"
            message="No General Provident Fund contributions have been recorded yet."
          />
        ) : (
          <DataTable<GpfRow>
            columns={[
              { key: "employeeCode", label: "Employee" },
              { key: "period", label: "Period" },
              { key: "contrib", label: "Employee GPF (10%)", align: "right", cellType: "amount" },
            ]}
            rows={tableRows}
            rowLinkKey="employeeId"
            rowLinkPrefix="/hr/employees/"
            sortable
            filterable
            filterPlaceholder="Filter by employee or period…"
            pageSize={20}
            emptyIcon="🏦"
            emptyTitle="No GPF statements found"
            emptyMessage="No General Provident Fund records match your filter."
          />
        )}
      </Card>
    </main>
  );
}
