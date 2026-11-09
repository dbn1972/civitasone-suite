import { PageHeader, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";
import { DaRatesManager, type DaRateRow } from "./DaRatesManager";

/**
 * UAT b23: a new tenant could not run payroll (DA_RATE_NOT_CONFIGURED) because no screen or API
 * recorded the Dearness Allowance rate. Payroll admins record each Jan / Jul revision here.
 * Writes: payroll_admin / super_admin (payroll-service WRITE_ROLES); readers per PAYROLL_READER_ROLES.
 */
const DA_WRITE_ROLES = ["payroll_admin", "super_admin"];

async function getRates(): Promise<LoaderResult<DaRateRow[]>> {
  return fetchJson<unknown, DaRateRow[]>("/api/v1/payroll/da-rates", [], {
    telemetryKey: "payroll.da-rates",
    mapResponse: (p) => {
      const arr = (p as { data?: DaRateRow[] } | undefined)?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DaRatesPage() {
  const t = await getTranslations("payrollDaRates");
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="da-rates" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const { data: rows, source } = await getRates();
  const errored = source === "error";
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      {errored ? (
        <div className="pad">
          <RefreshErrorState error={toHumanError("load", { area: "da-rates" })} backHref="/hr/payroll" />
        </div>
      ) : (
        <DaRatesManager rows={rows} canWrite={roles.some((r) => DA_WRITE_ROLES.includes(r))} />
      )}
    </div>
  );
}
