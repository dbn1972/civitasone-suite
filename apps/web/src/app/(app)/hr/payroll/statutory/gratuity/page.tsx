import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { GratuityCalculator } from "./GratuityCalculator";
import { toResourceState } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";

type GratuityRow = {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  /** Display-only: employeeName from the API, else the raw employeeId. */
  employee?: string;
  yearsOfService: number | string;
  gratuityMinor: number;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<GratuityRow[]>> {
  return fetchJson<unknown, GratuityRow[]>("/api/v1/payroll/statutory/gratuity", [], {
    telemetryKey: "payroll.statutory.gratuity",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: GratuityRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function GratuityPage() {
  const t = await getTranslations("gratuity");
  // GAP-PAYROLL-STATUTORY-GRATUITY-02: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API (gratuity register) is READER_ROLES-only in
  // payroll-service (no employee/manager). Gate before fetching so those
  // roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="gratuity register" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  const result = await getData();
  // GAP-PAYROLL-STATUTORY-GRATUITY-06: the register API now returns
  // employeeName (best-effort HRMS lookup, same as the GPF/NPS reports);
  // show it, falling back to the id only when HRMS had no name.
  const rows = result.data.map((r) => ({ ...r, employee: r.employeeName || r.employeeId }));
  const resource = toResourceState(result);
  const errored = resource.status === "error";
  const totalGratuityMinor = rows.reduce((s, r) => s + Number(r.gratuityMinor ?? 0), 0);
  const settledRecords = errored ? null : rows.filter((r) => r.status === "settled" || r.status === "paid").length;
  const avgYears =
    rows.length > 0
      ? (rows.reduce((s, r) => s + Number(r.yearsOfService || 0), 0) / rows.length).toFixed(1)
      : "0";

  const columns: {
    key: keyof GratuityRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount" | "status";
  }[] = [
    { key: "employee", label: t("colEmployee") },
    { key: "yearsOfService", label: t("colYearsOfService"), align: "right" },
    { key: "gratuityMinor", label: t("colGratuityAmount"), align: "right", cellType: "amount" },
    { key: "status", label: t("colStatus"), cellType: "status" },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("errorBackLabel")}
      />
      {/* GAP-PAYROLL-STATUTORY-GRATUITY-06: same load-failure signal as the
          sibling statutory pages; the calculator below is client-side and
          keeps working, which the badge message makes explicit. */}
      <DataSourceBadge source={result.source} message={t("loadErrorMessage")} />

      <StatGrid>
        <StatCard icon="🎖️" iconBg="var(--infobg)" label={t("statGratuityRecords")} value={errored ? "—" : rows.length} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statTotalGratuityComputed")} value={errored ? "—" : formatMoney(totalGratuityMinor)} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statSettledPaid")} value={settledRecords ?? "—"} />
        <StatCard icon="📅" iconBg="var(--panel)" label={t("statAvgYearsOfService")} value={errored ? "—" : avgYears} />
      </StatGrid>

      <GratuityCalculator />

      <Card title={t("registerCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "gratuity records" })} backHref="/hr/payroll/statutory" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🎖️"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable<GratuityRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            pageSize={15}
            emptyIcon="🎖️"
            emptyTitle={t("emptyTitleFiltered")}
            emptyMessage={t("emptyMessageFiltered")}
          />
        )}
      </Card>
    </div>
  );
}
