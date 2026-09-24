import { PageHeader, StatGrid, StatCard, Card, EmptyState, Button, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type PeriodSummary = {
  period: string;
  gross: number | string;
  net: number | string;
  headcount: number;
};

type CompareData = { period1: PeriodSummary; period2: PeriodSummary };

const PERIOD_RE = /^\d{4}-\d{2}$/;

async function getData(period1: string, period2: string): Promise<LoaderResult<CompareData | null>> {
  return fetchJson<unknown, CompareData | null>(
    `/api/v1/payroll/comparison?period1=${encodeURIComponent(period1)}&period2=${encodeURIComponent(period2)}`,
    null,
    {
      telemetryKey: "payroll.comparison",
      mapResponse: (p) => {
        const body = p as { period1?: PeriodSummary; period2?: PeriodSummary } | null;
        if (!body || !body.period1 || !body.period2) return null;
        return { period1: body.period1, period2: body.period2 };
      },
    },
  );
}

function delta(a: number, b: number): string {
  const d = b - a;
  const sign = d > 0 ? "+" : "";
  return `${sign}${formatMoney(d)}`;
}

export default async function PayrollComparisonPage({
  searchParams,
}: {
  searchParams?: { period1?: string; period2?: string };
}) {
  const t = await getTranslations("payrollComparison");
  const period1 = searchParams?.period1?.trim();
  const period2 = searchParams?.period2?.trim();
  const canCompare = !!period1 && !!period2 && PERIOD_RE.test(period1) && PERIOD_RE.test(period2);

  let data: CompareData | null = null;
  let source: "api" | "error" | null = null;
  if (canCompare) {
    const result = await getData(period1 as string, period2 as string);
    data = result.data;
    source = result.source;
  }

  const filterForm = (
    <Card title={t("filterCardTitle")} padding>
      <form method="get" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor="cmp-period1" style={{ fontSize: 13, fontWeight: 600 }}>
            {t("labelPeriod1")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span>
          </label>
          <input
            id="cmp-period1"
            name="period1"
            defaultValue={period1 ?? ""}
            placeholder="2025-05"
            aria-required="true"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          <label htmlFor="cmp-period2" style={{ fontSize: 13, fontWeight: 600 }}>
            {t("labelPeriod2")} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span>
          </label>
          <input
            id="cmp-period2"
            name="period2"
            defaultValue={period2 ?? ""}
            placeholder="2025-06"
            aria-required="true"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <Button type="submit" variant="primary" style={{ minHeight: 44 }}>{t("compareButton")}</Button>
        </div>
      </form>
    </Card>
  );

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      <DataSourceBadge source={source === "error" ? "error" : "api"} message="Couldn't load — showing nothing" />

      {canCompare && data && (
        <StatGrid>
          <StatCard icon="💰" iconBg="var(--infobg)" label={`${data.period1.period} Gross`} value={formatMoney(data.period1.gross)} />
          <StatCard icon="💰" iconBg="var(--goodbg)" label={`${data.period2.period} Gross`} value={formatMoney(data.period2.gross)} />
          <StatCard icon="👥" iconBg="var(--warnbg)" label={t("statHeadcountDelta")} value={(data.period2.headcount - data.period1.headcount > 0 ? "+" : "") + String(data.period2.headcount - data.period1.headcount)} />
          <StatCard icon="📊" iconBg="var(--goodbg)" label={t("statNetDelta")} value={delta(Number(data.period1.net), Number(data.period2.net))} />
        </StatGrid>
      )}

      {filterForm}

      {!canCompare && (
        <Card>
          <EmptyState
            icon="📊"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        </Card>
      )}

      {canCompare && data && (
        <Card title={`${data.period1.period} vs ${data.period2.period}`}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <caption className="sr-only">
                Payroll comparison between {data.period1.period} and {data.period2.period}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("colMetric")}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{data.period1.period}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{data.period2.period}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{t("colDelta")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{t("metricGross")}</th>
                  <td style={{ textAlign: "right" }}>{formatMoney(data.period1.gross)}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(data.period2.gross)}</td>
                  <td style={{ textAlign: "right" }}>{delta(Number(data.period1.gross), Number(data.period2.gross))}</td>
                </tr>
                <tr>
                  <th scope="row">{t("metricNet")}</th>
                  <td style={{ textAlign: "right" }}>{formatMoney(data.period1.net)}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(data.period2.net)}</td>
                  <td style={{ textAlign: "right" }}>{delta(Number(data.period1.net), Number(data.period2.net))}</td>
                </tr>
                <tr>
                  <th scope="row">{t("metricHeadcount")}</th>
                  <td style={{ textAlign: "right" }}>{data.period1.headcount}</td>
                  <td style={{ textAlign: "right" }}>{data.period2.headcount}</td>
                  <td style={{ textAlign: "right" }}>
                    {data.period2.headcount - data.period1.headcount > 0 ? "+" : ""}
                    {data.period2.headcount - data.period1.headcount}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {canCompare && source === "error" && (
        <Card>
          <RefreshErrorState error={toHumanError("load", { area: "payroll comparison" })} backHref="/hr/payroll" />
        </Card>
      )}

      {canCompare && !data && source !== "error" && (
        <Card>
          <EmptyState
            icon="📊"
            title={t("noDataTitle")}
            message={t("noDataMessage")}
          />
        </Card>
      )}
    </div>
  );
}
