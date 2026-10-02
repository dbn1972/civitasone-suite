import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { PageHeader, StatGrid, StatCard, RefreshErrorState } from "../../../../_components/ds";
import { getSalarySlips } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { SalarySlipsTable } from "./SalarySlipsTable";
import { getTranslations } from "next-intl/server";
import { SALARY_ADMIN_ROLES } from "./_salaryAdminRoles";
import { ALL_PERIODS, SLIPS_PAGE_LIMIT, distinctPeriods, mayBeTruncated, resolvePeriod, sumSlips } from "./slipPeriods";

export default async function SalarySlipsPage({ searchParams }: { searchParams?: { period?: string } }) {
  const t = await getTranslations("salarySlips");
  const roles = getSessionRoles();
  const canView = roles.some((r) => SALARY_ADMIN_ROLES.includes(r));
  if (!canView) {
    return <PermissionDenied module="salary slips" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  const { data: allSlips, source } = await getSalarySlips(SLIPS_PAGE_LIMIT, 0);
  // GAP-PAYROLL-SALARY-SLIPS-01: a failed fetch used to read as good news --
  // zeros and an empty-state. Errors now show dashes and a retryable error.
  const errored = source === "error";

  // GAP-PAYROLL-SALARY-SLIPS-02/03: totals are per selected pay period (slips
  // from different months were summed together) and only printed when the
  // page is known to hold every slip -- the API caps a response at
  // SLIPS_PAGE_LIMIT rows and returns no total, so a full page may be cut off.
  const truncated = !errored && mayBeTruncated(allSlips.length);
  const periods = distinctPeriods(allSlips);
  const period = resolvePeriod(searchParams?.period, periods);
  const slips = period === ALL_PERIODS ? allSlips : allSlips.filter((s) => s.payPeriod === period);
  const totals = sumSlips(slips);
  const showMoney = !errored && !truncated && period !== ALL_PERIODS;

  const totalSlips = errored ? null : truncated ? `${slips.length}+` : slips.length;
  const totalGross = showMoney ? formatMoney(totals.grossMinor) : errored ? null : "—";
  const totalNet = showMoney ? formatMoney(totals.netMinor) : errored ? null : "—";
  const draftCount = errored ? null : slips.filter((s) => s.status === "draft").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
        help="payroll"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      {!errored && periods.length > 0 && (
        <form method="get" style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", margin: "0 0 12px" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor="slip-period" style={{ fontSize: 12, fontWeight: 600 }}>{t("periodLabel")}</label>
            <select id="slip-period" name="period" defaultValue={period} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", minHeight: 40 }}>
              {periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value={ALL_PERIODS}>{t("allPeriods")}</option>
            </select>
          </div>
          <button type="submit" className="btn" style={{ minHeight: 40 }}>{t("applyPeriod")}</button>
        </form>
      )}
      {truncated && (
        <p role="status" className="pill warn" style={{ width: "fit-content", margin: "0 0 12px" }}>
          {t("truncatedNotice", { count: SLIPS_PAGE_LIMIT })}
        </p>
      )}
      {!errored && !truncated && period === ALL_PERIODS && slips.length > 0 && (
        <p role="note" style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink2)" }}>{t("allPeriodsTotalsHidden")}</p>
      )}
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--panel)" label={t("statTotal")} value={totalSlips} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")} value={totalGross} />
        <StatCard icon="✅" iconBg="var(--infobg)" label={t("statNet")} value={totalNet} />
        <StatCard icon="📄" iconBg="var(--warnbg)" label={t("statDraft")} value={draftCount} />
      </StatGrid>
      {errored ? (
        <RefreshErrorState error={toHumanError("load", { area: "salary slips" })} backHref="/hr/payroll" />
      ) : (
        <SalarySlipsTable slips={slips} />
      )}
    </div>
  );
}
