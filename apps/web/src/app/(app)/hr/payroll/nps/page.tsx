import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getNpsStatements } from "../../../../_data/loaders";
import { Chart } from "../../../../_components/Chart";

type NpsRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  period: string;
  emp: number;
  er: number;
} & Record<string, unknown>;

// NPS return assumption: 9.5% p.a. (PFRDA-reported long-term median across Tier-I schemes)
const ASSUMED_ANNUAL_RETURN = 0.095;

function projectCorpus(totalContribMinor: number, yearsRemaining: number): number {
  // FV of lump-sum at assumed rate
  return totalContribMinor * Math.pow(1 + ASSUMED_ANNUAL_RETURN, yearsRemaining);
}

export default async function NpsStatementsPage() {
  const { data: rows, source } = await getNpsStatements();

  const tableRows: NpsRow[] = rows.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: r.employeeId.slice(0, 8).toUpperCase(),
    period: r.period,
    emp: r.empContribMinor ?? 0,
    er: r.erContribMinor ?? 0,
  }));

  const uniqueEmps = new Set(tableRows.map((r) => r.employeeId)).size;
  const totalEmp = tableRows.reduce((s, r) => s + (Number(r.emp) || 0), 0);
  const totalEr = tableRows.reduce((s, r) => s + (Number(r.er) || 0), 0);
  const totalCorpus = totalEmp + totalEr; // simplified: total accumulated so far

  // Period-wise trend data (last 6 periods)
  const periodMap = new Map<string, number>();
  for (const r of tableRows) {
    const key = r.period;
    periodMap.set(key, (periodMap.get(key) ?? 0) + (Number(r.emp) || 0) + (Number(r.er) || 0));
  }
  const sortedPeriods = Array.from(periodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6);
  const trendChartData = sortedPeriods.map(([label, value]) => ({
    label: label.slice(2), // "2026-06" → "26-06"
    value: Math.round(value / 100), // minor to rupees
  }));

  // Projection: assume average 25 years remaining to retirement
  const AVG_YEARS_TO_RETIRE = 25;
  const projectedCorpus = projectCorpus(totalCorpus, AVG_YEARS_TO_RETIRE);
  const formatMoney = (minor: number) =>
    `₹${(minor / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="NPS Statements"
        subtitle="National Pension System contributions — 10% employee + 14% employer (GoI 2019 amendment)."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Statements" value={tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label="Employees" value={uniqueEmps} />
        <StatCard icon="🧑" iconBg="var(--warnbg)" label="Total Employee (10%)" value={formatMoney(totalEmp)} />
        <StatCard icon="🏛️" iconBg="var(--panel)" label="Total Employer (14%)" value={formatMoney(totalEr)} />
      </StatGrid>

      {/* NPS Corpus Dashboard */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          marginTop: 4,
        }}
      >
        {/* Current corpus */}
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
            {formatMoney(totalCorpus)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--fg2)" }}>
            Employee + Employer contributions (all periods)
          </p>
        </div>

        {/* Last period contribution */}
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

        {/* Projected corpus */}
        <div
          style={{
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "#14532d", textTransform: "uppercase" }}>
            Projected Corpus at Retirement
          </p>
          <p style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 800, color: "#16a34a" }}>
            {formatMoney(projectedCorpus)}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "#14532d" }}>
            @9.5% p.a. over {AVG_YEARS_TO_RETIRE} yrs (illustrative — PFRDA median). Not a guarantee.
          </p>
        </div>
      </div>

      {/* Contribution trend */}
      {trendChartData.length > 1 && (
        <Card title="Contribution Trend (last 6 periods, ₹)">
          <Chart type="bar" data={trendChartData} height={180} />
        </Card>
      )}

      <Card title="NPS Ledger">
        {tableRows.length === 0 ? (
          <EmptyState
            icon="🏦"
            title="No NPS statements"
            message="No National Pension System contributions have been recorded yet."
          />
        ) : (
          <DataTable<NpsRow>
            columns={[
              { key: "employeeCode", label: "Employee" },
              { key: "period", label: "Period" },
              { key: "emp", label: "Employee (10%)", align: "right", cellType: "amount" },
              { key: "er", label: "Employer (14%)", align: "right", cellType: "amount" },
            ]}
            rows={tableRows}
            rowLinkKey="employeeId"
            rowLinkPrefix="/hr/employees/"
            sortable
            filterable
            filterPlaceholder="Filter by employee or period…"
            pageSize={20}
            emptyIcon="🏦"
            emptyTitle="No NPS statements found"
            emptyMessage="No National Pension System records match your filter."
          />
        )}
      </Card>
    </main>
  );
}
