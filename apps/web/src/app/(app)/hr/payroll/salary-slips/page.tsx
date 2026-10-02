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

export default async function SalarySlipsPage() {
  const t = await getTranslations("salarySlips");
  const roles = getSessionRoles();
  const canView = roles.some((r) => SALARY_ADMIN_ROLES.includes(r));
  if (!canView) {
    return <PermissionDenied module="salary slips" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  const { data: slips, source } = await getSalarySlips();
  // GAP-PAYROLL-SALARY-SLIPS-01: a failed fetch used to read as good news --
  // data=[] on error meant the four StatCards showed real-looking zeros
  // (formatMoney(0) = "₹0.00", a genuine amount) and the table fell through
  // to its ordinary "No salary slips yet — go to payroll runs" empty state,
  // with only the DataSourceBadge above hinting anything was wrong. Payroll
  // staff reading this as "no slips exist" during a real outage is the
  // actual failure mode this gap is about.
  const errored = source === "error";

  const totalSlips = errored ? null : slips.length;
  const totalGross = errored ? null : formatMoney(slips.reduce((sum, s) => sum + s.gross, 0));
  const totalNet = errored ? null : formatMoney(slips.reduce((sum, s) => sum + s.net, 0));
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
