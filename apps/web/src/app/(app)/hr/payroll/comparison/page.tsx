import { PageHeader, StatGrid, StatCard, Card, EmptyState, Button, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_REPORT_ROLES } from "@/lib/auth/roleGuard";
import { PERIOD_PATTERN, parsePeriodParam, type PeriodParam } from "@/lib/payroll/period";
import { formatSignedMoney, formatSignedPercent, percentChange, toMinorBigInt } from "@/lib/payroll/money";
import { getTranslations } from "next-intl/server";
import { mapComparisonResponse, type CompareData } from "./mapComparisonResponse";

async function getData(period1: string, period2: string): Promise<LoaderResult<CompareData | null>> {
  return fetchJson<unknown, CompareData | null>(
    `/api/v1/payroll/comparison?period1=${encodeURIComponent(period1)}&period2=${encodeURIComponent(period2)}`,
    null,
    { telemetryKey: "payroll.comparison", mapResponse: mapComparisonResponse },
  );
}

function headcountDelta(a: number, b: number): string {
  const d = b - a;
  return d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "0";
}

export default async function PayrollComparisonPage({
  searchParams,
}: {
  searchParams?: { period1?: string; period2?: string };
}) {
  const t = await getTranslations("payrollComparison");

  // GAP-PAYROLL-COMPARISON-03: org-wide gross/net/headcount must not reach
  // employee/manager sessions (hr/layout.tsx admits both).
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_REPORT_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="payroll comparison" requiredRoles={PAYROLL_REPORT_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }

  // GAP-PAYROLL-COMPARISON-01: strict YYYY-MM (month 01-12) with a per-field
  // error instead of silently falling back to the "choose two periods" state.
  const p1 = parsePeriodParam(searchParams?.period1);
  const p2 = parsePeriodParam(searchParams?.period2);
  const anyEntered = p1.state !== "empty" || p2.state !== "empty";
  const canCompare = p1.state === "valid" && p2.state === "valid";
  const fieldError = (p: PeriodParam): string | null =>
    !anyEntered ? null : p.state === "empty" ? t("periodRequiredError") : p.state === "invalid" ? t("periodInvalidError", { value: p.raw }) : null;
  const err1 = fieldError(p1);
  const err2 = fieldError(p2);

  const valid1 = p1.state === "valid" ? p1.period : "";
  const valid2 = p2.state === "valid" ? p2.period : "";

  let data: CompareData | null = null;
  let source: "api" | "error" | null = null;
  if (canCompare) {
    const result = await getData(valid1, valid2);
    data = result.data;
    source = result.source;
  }
  const period1 = p1.state === "valid" ? p1.period : p1.state === "invalid" ? p1.raw : "";
  const period2 = p2.state === "valid" ? p2.period : p2.state === "invalid" ? p2.raw : "";
  const both = data && data.period1 && data.period2 ? { a: data.period1, b: data.period2 } : null;

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  const periodField = (id: string, name: string, label: string, value: string, error: string | null, placeholder: string) => (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
        {label} <span aria-hidden="true" style={{ color: "var(--color-error)" }}>*</span>
      </label>
      <input
        id={id}
        name={name}
        type="month"
        pattern={PERIOD_PATTERN}
        defaultValue={value}
        placeholder={placeholder}
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        style={inputStyle}
      />
      {error && (
        <p id={`${id}-err`} role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>{error}</p>
      )}
    </div>
  );

  // GAP-PAYROLL-COMPARISON-04: exact bigint deltas, a real minus sign, a %
  // column, and a screen-reader word so the direction isn't sign-only.
  const moneyDeltaCell = (aRaw: number | string, bRaw: number | string) => {
    const a = toMinorBigInt(aRaw);
    const b = toMinorBigInt(bRaw);
    const d = a !== null && b !== null ? b - a : null;
    const direction = d === null || d === 0n ? null : d > 0n ? t("srIncrease") : t("srDecrease");
    return (
      <>
        <td style={{ textAlign: "right" }}>
          {direction && <span className="sr-only">{direction} </span>}
          {formatSignedMoney(d)}
        </td>
        <td style={{ textAlign: "right" }}>{formatSignedPercent(percentChange(a, b))}</td>
      </>
    );
  };

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />

      {both && (
        <StatGrid>
          <StatCard icon="💰" iconBg="var(--infobg)" label={t("periodGrossLabel", { period: both.a.period })} value={formatMoney(both.a.gross)} />
          <StatCard icon="💰" iconBg="var(--goodbg)" label={t("periodGrossLabel", { period: both.b.period })} value={formatMoney(both.b.gross)} />
          <StatCard icon="👥" iconBg="var(--warnbg)" label={t("statHeadcountDelta")} value={headcountDelta(both.a.headcount, both.b.headcount)} />
          <StatCard
            icon="📊"
            iconBg="var(--goodbg)"
            label={t("statNetDelta")}
            value={formatSignedMoney(
              (() => { const a = toMinorBigInt(both.a.net); const b = toMinorBigInt(both.b.net); return a !== null && b !== null ? b - a : null; })(),
            )}
          />
        </StatGrid>
      )}

      <Card title={t("filterCardTitle")} padding>
        <form method="get" noValidate style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          {periodField("cmp-period1", "period1", t("labelPeriod1"), period1, err1, "2025-05")}
          {periodField("cmp-period2", "period2", t("labelPeriod2"), period2, err2, "2025-06")}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button type="submit" variant="primary" style={{ minHeight: 44 }}>{t("compareButton")}</Button>
          </div>
        </form>
      </Card>

      {!anyEntered && (
        <Card>
          <EmptyState icon="📊" title={t("emptyTitle")} message={t("emptyMessage")} />
        </Card>
      )}

      {both && (
        <Card title={t("comparisonCardTitle", { period1: both.a.period, period2: both.b.period })}>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <caption className="sr-only">
                {t("comparisonCaption", { period1: both.a.period, period2: both.b.period })}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("colMetric")}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{both.a.period}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{both.b.period}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{t("colDelta")}</th>
                  <th scope="col" style={{ textAlign: "right" }}>{t("colDeltaPct")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">{t("metricGross")}</th>
                  <td style={{ textAlign: "right" }}>{formatMoney(both.a.gross)}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(both.b.gross)}</td>
                  {moneyDeltaCell(both.a.gross, both.b.gross)}
                </tr>
                <tr>
                  <th scope="row">{t("metricNet")}</th>
                  <td style={{ textAlign: "right" }}>{formatMoney(both.a.net)}</td>
                  <td style={{ textAlign: "right" }}>{formatMoney(both.b.net)}</td>
                  {moneyDeltaCell(both.a.net, both.b.net)}
                </tr>
                <tr>
                  <th scope="row">{t("metricHeadcount")}</th>
                  <td style={{ textAlign: "right" }}>{both.a.headcount}</td>
                  <td style={{ textAlign: "right" }}>{both.b.headcount}</td>
                  <td style={{ textAlign: "right" }}>{headcountDelta(both.a.headcount, both.b.headcount)}</td>
                  <td style={{ textAlign: "right" }}>
                    {formatSignedPercent(percentChange(BigInt(Math.trunc(Number(both.a.headcount) || 0)), BigInt(Math.trunc(Number(both.b.headcount) || 0))))}
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

      {canCompare && source !== "error" && !both && (
        <Card>
          <EmptyState
            icon="📊"
            title={t("noDataTitle")}
            message={
              !data || (!data.period1 && !data.period2)
                ? t("noDataBothMessage", { period1: valid1, period2: valid2 })
                : t("noDataPeriodMessage", { period: !data.period1 ? valid1 : valid2 })
            }
          />
        </Card>
      )}
    </div>
  );
}
