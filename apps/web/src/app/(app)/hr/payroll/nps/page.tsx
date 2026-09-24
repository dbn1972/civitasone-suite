import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../../_components/ds";
import { getNpsStatements } from "../../../../_data/loaders";
import { Chart } from "../../../../_components/Chart";
import { useResource } from "../../../../_data/useResource";
import { toHumanError } from "@/lib/messages";

type NpsRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
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
  const t = await getTranslations("npsStatements");
  const result = await getNpsStatements();
  const { data: rows } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const tableRows: NpsRow[] = rows.map((r) => {
    const employeeCode = r.employeeId.slice(0, 8).toUpperCase();
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeCode,
      // UX-021: see hr/payroll/gpf/page.tsx -- same best-effort fallback.
      employeeName: r.employeeName ?? employeeCode,
      period: r.period,
      emp: r.empContribMinor ?? 0,
      er: r.erContribMinor ?? 0,
    };
  });

  const uniqueEmps = errored ? null : new Set(tableRows.map((r) => r.employeeId)).size;
  // Raw (not gated): tableRows is already [] on a real fetch failure, so
  // these stay true 0s — projectCorpus() below needs a real number either way.
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
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statStatements")} value={errored ? "—" : tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label={t("statEmployees")} value={uniqueEmps ?? "—"} />
        <StatCard icon="🧑" iconBg="var(--warnbg)" label={t("statTotalEmployee")} value={errored ? "—" : formatMoney(totalEmp)} />
        <StatCard icon="🏛️" iconBg="var(--panel)" label={t("statTotalEmployer")} value={errored ? "—" : formatMoney(totalEr)} />
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
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--mut)", textTransform: "uppercase" }}>
            {t("accumulatedCorpusLabel")}
          </p>
          <p style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "var(--ink)" }}>
            {errored ? "—" : formatMoney(totalCorpus)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
            {t("accumulatedCorpusNote")}
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
            <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--mut)", textTransform: "uppercase" }}>
              {t("lastPeriodLabel")}
            </p>
            <p style={{ margin: "0 0 2px", fontSize: 20, fontWeight: 700, color: "var(--ink)" }}>
              {formatMoney(sortedPeriods[sortedPeriods.length - 1][1])}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
              {t("periodValue", { period: sortedPeriods[sortedPeriods.length - 1][0] })}
            </p>
          </div>
        )}

        {/* Projected corpus */}
        <div
          style={{
            background: "var(--goodbg, #f0fdf4)",
            border: "1px solid var(--goodbd, #bbf7d0)",
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--good, #14532d)", textTransform: "uppercase" }}>
            {t("projectedCorpusLabel")}
          </p>
          <p style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 800, color: "var(--good, #16a34a)" }}>
            {errored ? "—" : formatMoney(projectedCorpus)}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "var(--good, #14532d)" }}>
            {t("projectionNote", { years: AVG_YEARS_TO_RETIRE })}
          </p>
        </div>
      </div>

      {/* Contribution trend */}
      {trendChartData.length > 1 && (
        <Card title={t("trendCardTitle")}>
          <Chart type="bar" data={trendChartData} height={180} />
        </Card>
      )}

      <Card title={t("ledgerCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll" />
          </div>
        ) : tableRows.length === 0 ? (
          <EmptyState
            icon="🏦"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<NpsRow>
            columns={[
              { key: "employeeName", label: t("colEmployee") },
              { key: "employeeCode", label: t("colCode") },
              { key: "period", label: t("colPeriod") },
              { key: "emp", label: t("colEmployeeContrib"), align: "right", cellType: "amount" },
              { key: "er", label: t("colEmployerContrib"), align: "right", cellType: "amount" },
            ]}
            rows={tableRows}
            rowLinkKey="employeeId"
            rowLinkPrefix="/hr/employees/"
            identifyingColumnKey="employeeName"
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={20}
            emptyIcon="🏦"
            emptyTitle={t("emptyTitleFiltered")}
            emptyMessage={t("emptyMessageFiltered")}
          />
        )}
      </Card>
    </div>
  );
}
