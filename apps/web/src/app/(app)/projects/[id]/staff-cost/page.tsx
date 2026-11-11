import { getTranslations } from "next-intl/server";
import { PageHeader, Card, DataTable, RefreshErrorState, StatGrid, StatCard } from "@/app/_components/ds";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { toHumanError } from "@/lib/messages";
import { formatMoney } from "@/lib/formatters";
import { isValidPeriod } from "@/lib/payroll/period";
import { defaultRange, getStaffCost } from "./staffCostData";

type Row = Record<string, unknown>;

/**
 * A project's staff cost as TOTALS (S8 G7). For the project's manager and for
 * finance. Individual pay is never on this page and not in the data behind it:
 * project-service stores aggregates only, and the API answers 403 to anyone who
 * is not this project's manager (or finance / audit).
 */
export default async function ProjectStaffCostPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const t = await getTranslations("projectStaffCost");
  const dflt = defaultRange();
  const from = sp.from && isValidPeriod(sp.from) ? sp.from.trim() : dflt.from;
  const to = sp.to && isValidPeriod(sp.to) ? sp.to.trim() : dflt.to;
  const range = from <= to ? { from, to } : dflt;

  const res = await getStaffCost(id, range.from, range.to);
  const back = `/projects/${id}`;

  if (res.status === 403) {
    return <PermissionDenied module="project staff cost" requiredRoles={["project_manager", "finance_officer"]} backHref={back} backLabel={t("backLabel")} />;
  }
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back={back} backLabel={t("backLabel")} />
      <p role="note" className="pill" style={{ margin: "0 0 12px", width: "fit-content" }}>{t("totalsOnlyNote")}</p>
      {res.source === "error" || !res.data ? (
        <RefreshErrorState error={toHumanError("load", { area: "project staff cost" })} backHref={back} />
      ) : (
        <>
          <StatGrid>
            <StatCard icon="₹" iconBg="var(--infobg)" label={t("statGross")} value={formatMoney(res.data.totals.grossMinor)} />
            <StatCard icon="₹" iconBg="var(--warnbg)" label={t("statEmployer")} value={formatMoney(res.data.totals.employerCostMinor)} />
            <StatCard icon="₹" iconBg="var(--goodbg)" label={t("statTotal")} value={formatMoney(res.data.totals.totalCostMinor)} />
          </StatGrid>
          {res.data.suppressedPeriods > 0 && (
            <p role="note" className="pill" style={{ margin: "12px 0", width: "fit-content" }}>{t("suppressedNotice")}</p>
          )}
          <Card title={t("tableTitle", { from: range.from, to: range.to })}>
            <DataTable<Row>
              columns={[
                { key: "period", label: t("colPeriod") },
                { key: "gross", label: t("colGross"), align: "right" },
                { key: "employer", label: t("colEmployer"), align: "right" },
                { key: "total", label: t("colTotal"), align: "right" },
                { key: "headcount", label: t("colHeadcount"), align: "right" },
              ]}
              rows={res.data.periods.map((p) => p.suppressed
                ? { id: p.period, period: p.period, gross: t("suppressedCell"), employer: t("suppressedCell"), total: t("suppressedCell"), headcount: "—" }
                : { id: p.period, period: p.period, gross: formatMoney(p.grossMinor), employer: formatMoney(p.employerCostMinor), total: formatMoney(p.totalCostMinor), headcount: p.headcount })}
              emptyIcon="📊" emptyTitle={t("emptyTitle")} emptyMessage={t("emptyMessage")}
            />
          </Card>
        </>
      )}
    </>
  );
}
