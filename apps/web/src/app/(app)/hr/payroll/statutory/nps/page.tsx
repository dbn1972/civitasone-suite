import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { NpsHistoryTable } from "./NpsHistoryTable";

type NpsRow = {
  id: string;
  employeeId: string;
  employeeName: string | null;
  period: string;
  basicMinor: number;
  empContribPct: number;
  erContribPct: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<NpsRow[]>> {
  return fetchJson<unknown, NpsRow[]>("/api/v1/payroll/statutory/nps", [], {
    telemetryKey: "payroll.statutory.nps",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: NpsRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function NpsStatutoryPage() {
  const t = await getTranslations("nps");

  // GAP-PAYROLL-STATUTORY-NPS-03: payroll-service's statutory/routes.ts
  // READER_ROLES for GET /v1/payroll/statutory/nps is
  // [payroll_admin, payroll_officer, super_admin, hr_admin, finance_officer]
  // -- no "employee", no self-service scoping (unlike income-tax/form12ba),
  // so an employee/manager reaching this page today gets a flat backend 403
  // on every row, not a leak. PAYROLL_STATUTORY_ADMIN_ROLES mirrors that
  // list exactly; this page-level gate turns that 403 into a clear message
  // instead of a blank/broken table.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="NPS contributions" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("backToStatutoryLabel")} />;
  }

  const { data: rows, source } = await getData();
  const errored = source === "error";

  const totalEmpContribMinor = rows.reduce((s, r) => s + Number(r.empContribMinor ?? 0), 0);
  const totalErContribMinor = rows.reduce((s, r) => s + Number(r.erContribMinor ?? 0), 0);
  const totalNpsMinor = totalEmpContribMinor + totalErContribMinor;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("backToStatutoryLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="📊" iconBg="var(--infobg)" label={t("statNpsRecords")} value={errored ? null : rows.length} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmployeeContribution")} value={errored ? null : formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏛️" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={errored ? null : formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label={t("statTotalNpsOutflow")} value={errored ? null : formatMoney(totalNpsMinor)} />
      </StatGrid>
      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            {/* GAP-PAYROLL-STATUTORY-NPS-06: "nps" was a bare, untranslated
                token interpolated straight into the "We couldn't load {area}"
                sentence. */}
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <NpsHistoryTable rows={rows} />
        )}
      </Card>
    </div>
  );
}
