import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState, Term } from "../../../../_components/ds";
import { getGpfStatements } from "../../../../_data/loaders";
import { Chart } from "../../../../_components/Chart";
import { useResource } from "../../../../_data/useResource";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";

type GpfRow = {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  period: string;
  contrib: number | string;
} & Record<string, unknown>;

// GPF earns interest at GoI-declared rate; currently 7.1% p.a. (as of Q1 FY 2026-27)
const GPF_INTEREST_RATE = 0.071;

function projectGpfCorpus(totalMinor: number, yearsRemaining: number): number {
  return totalMinor * Math.pow(1 + GPF_INTEREST_RATE, yearsRemaining);
}

export default async function GpfStatementsPage() {
  const t = await getTranslations("gpfStatements");
  const result = await getGpfStatements();
  const { data: rows } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const tableRows: GpfRow[] = rows.map((r) => {
    const employeeCode = r.employeeId.slice(0, 8).toUpperCase();
    return {
      id: r.id,
      employeeId: r.employeeId,
      employeeCode,
      // UX-021: employeeName is best-effort (payroll-service enriches via
      // hrms-client, which fails open on an unreachable HRMS); fall back to
      // the code so the identifying column -- and its row-link accessible
      // name -- always shows something rather than a raw "null".
      employeeName: r.employeeName ?? employeeCode,
      period: r.period,
      contrib: r.empContribMinor ?? 0,
    };
  });

  const uniqueEmps = errored ? null : new Set(tableRows.map((r) => r.employeeId)).size;
  const uniquePeriods = errored ? null : new Set(tableRows.map((r) => r.period)).size;
  // Raw (not gated): tableRows is already [] on a real fetch failure (the
  // loader's empty fallback), so this stays a true 0 rather than needing a
  // null placeholder — projectGpfCorpus() below needs a real number either way.
  const totalContrib = tableRows.reduce((s, r) => s + (Number(r.contrib) || 0), 0);

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
        title={t.rich("title", { term: () => <Term name="GPF" /> })}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
        help="payroll"
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label={t("statStatements")} value={errored ? "—" : tableRows.length} />
        <StatCard icon="👥" iconBg="var(--goodbg)" label={t("statEmployees")} value={uniqueEmps ?? "—"} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statTotalContributions")} value={errored ? "—" : formatMoney(totalContrib)} />
        <StatCard icon="📅" iconBg="var(--panel)" label={t("statPeriods")} value={uniquePeriods ?? "—"} />
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
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--mut)", textTransform: "uppercase" }}>
            {t("accumulatedCorpusLabel")}
          </p>
          <p style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 800, color: "var(--ink)" }}>
            {errored ? "—" : formatMoney(totalContrib)}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--mut)" }}>
            {t("accumulatedCorpusNote")}
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

        <div
          style={{
            background: "var(--infobg, #eff6ff)",
            border: "1px solid var(--infobd, #bfdbfe)",
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <p style={{ margin: "0 0 4px", fontSize: 11, fontWeight: 600, color: "var(--info, #1e40af)", textTransform: "uppercase" }}>
            {t("projectedValueLabel")}
          </p>
          <p style={{ margin: "0 0 2px", fontSize: 22, fontWeight: 800, color: "var(--info, #1d4ed8)" }}>
            {errored ? "—" : formatMoney(projectedCorpus)}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: "var(--info, #1e40af)" }}>
            {t("projectionNote", { years: AVG_YEARS_TO_RETIRE })}
          </p>
        </div>
      </div>

      {trendChartData.length > 1 && (
        <Card title={t("trendCardTitle")}>
          <Chart type="line" data={trendChartData} height={180} />
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
          <DataTable<GpfRow>
            columns={[
              { key: "employeeName", label: t("colEmployee") },
              { key: "employeeCode", label: t("colCode") },
              { key: "period", label: t("colPeriod") },
              { key: "contrib", label: t("colContribution"), align: "right", cellType: "amount" },
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
    </main>
  );
}
