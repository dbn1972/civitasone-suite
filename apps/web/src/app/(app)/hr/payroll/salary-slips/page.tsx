import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { PageHeader, StatGrid, StatCard } from "../../../../_components/ds";
import { getSalarySlips } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { SalarySlipsTable } from "./SalarySlipsTable";
import { getTranslations } from "next-intl/server";

// GAP-HR-SF09A-017: kept in sync with the identical arrays in
// ./[id]/page.tsx and ../slips/[id]/page.tsx (enforced by
// salary-admin-roles.test.ts) -- added "finance_officer" to match the
// sibling PENSIONER_VIEW_ROLES (../pensioners/page.tsx), which already
// includes it for the same reason: GET /v1/payroll/salary-slips already
// admits finance_officer server-side (payroll-service payroll/routes.ts),
// this array was just never updated to match.
export const SALARY_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"];

export default async function SalarySlipsPage() {
  const t = await getTranslations("salarySlips");
  const roles = getSessionRoles();
  const canView = roles.some((r) => SALARY_ADMIN_ROLES.includes(r));
  if (!canView) {
    return <PermissionDenied module="salary slips" requiredRoles={SALARY_ADMIN_ROLES} />;
  }

  const { data: slips, source } = await getSalarySlips();

  const totalSlips = slips.length;
  const totalGross = slips.reduce((sum, s) => sum + s.gross, 0);
  const totalNet = slips.reduce((sum, s) => sum + s.net, 0);
  const draftCount = slips.filter((s) => s.status === "draft").length;

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
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")} value={formatMoney(totalGross)} />
        <StatCard icon="✅" iconBg="var(--infobg)" label={t("statNet")} value={formatMoney(totalNet)} />
        <StatCard icon="📄" iconBg="var(--warnbg)" label={t("statDraft")} value={draftCount} />
      </StatGrid>
      <SalarySlipsTable slips={slips} />
    </div>
  );
}
