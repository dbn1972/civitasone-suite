import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, RefreshErrorState } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles, PAYROLL_ADMIN_ROLES, PAYROLL_READER_ROLES } from "@/lib/auth/roleGuard";
import { CreateOffCycleForm } from "./CreateOffCycleForm";
import { OffCycleCards } from "./OffCycleCard";
import type { OffCycleRow } from "./types";
import { toHumanError } from "@/lib/messages";

async function getData(): Promise<LoaderResult<OffCycleRow[]>> {
  return fetchJson<unknown, OffCycleRow[]>("/api/v1/payroll/off-cycle", [], {
    telemetryKey: "payroll.off-cycle",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: OffCycleRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function OffCyclePage() {
  const t = await getTranslations("offCycle");

  // GAP-PAYROLL-OFF-CYCLE-06: GET /v1/payroll/off-cycle is READER_ROLES and
  // create/process are PAYROLL_ROLES (payroll-service gap-routes.ts) --
  // mirrored here instead of showing every hr/layout role (incl. employee
  // and manager) a create form and Process buttons that can only 403.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_READER_ROLES.includes(r))) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
        <PermissionDenied module="off-cycle payroll" requiredRoles={PAYROLL_READER_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }
  const canAdminister = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));

  const { data: items, source } = await getData();
  const errored = source === "error";

  const draftCount = items.filter((r) => r.status === "draft").length;
  const totalAmountMinor = items.reduce((sum, r) => sum + BigInt(String(r.total_amount_minor ?? 0)), 0n);
  const totalNetMinor = items.reduce((sum, r) => sum + BigInt(String(r.total_net_minor ?? 0)), 0n);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="🗂️" iconBg="var(--infobg)" label={t("statTotalRuns")} value={errored ? null : items.length} />
        <StatCard icon="📝" iconBg="var(--warnbg)" label={t("statDraftPending")} value={errored ? null : draftCount} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalAmount")} value={errored ? null : formatMoney(totalAmountMinor)} />
        <StatCard icon="🧾" iconBg="var(--infobg)" label={t("statTotalNetProcessed")} value={errored ? null : formatMoney(totalNetMinor)} />
      </StatGrid>

      {canAdminister && <CreateOffCycleForm />}

      {/* Card view: run type, period, employees in scope, approval status, process action */}
      <Card title={t("runsCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "off cycle" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <div style={{ padding: "0 4px" }}>
            <OffCycleCards rows={items} canProcess={canAdminister} />
          </div>
        )}
      </Card>
    </div>
  );
}
