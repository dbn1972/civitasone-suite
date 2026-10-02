import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { LwfConfigForm } from "./LwfConfigForm";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";

type LwfRow = {
  state_code: string;
  employee_contrib_minor: number | string;
  employer_contrib_minor: number | string;
  frequency: string;
} & Record<string, unknown>;

type StateRulesResponse = { ptSlabs?: unknown[]; lwfConfig?: LwfRow[] };

async function getData(): Promise<LoaderResult<LwfRow[]>> {
  return fetchJson<StateRulesResponse, LwfRow[]>("/api/v1/payroll/statutory/state-rules", [], {
    telemetryKey: "payroll.statutory.lwf",
    mapResponse: (p) => (Array.isArray(p?.lwfConfig) ? p.lwfConfig! : null),
  });
}

export default async function LwfPage() {
  const t = await getTranslations("lwf");
  // GAP-PAYROLL-STATUTORY-LWF-01: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API (labour welfare fund) is READER_ROLES-only in
  // payroll-service (no employee/manager). Gate before fetching so those
  // roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="labour welfare fund" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  // GAP-PAYROLL-STATUTORY-LWF-01: POST statutory/state-rules is PAYROLL_ROLES-only
  // (payroll_admin/payroll_officer/super_admin); hr_admin/finance_officer may read.
  const canEdit = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  const { data: rows, source } = await getData();
  const errored = source === "error";

  // GAP-PAYROLL-STATUTORY-LWF-03: the three dropped tiles summed different
  // states' flat rupee amounts together and counted distinct frequency
  // *strings* -- neither is a meaningful figure (LWF is a flat amount per
  // state, not a rate to sum, and "3 unique frequencies" says nothing useful
  // on its own). Replaced with a monthly-vs-other frequency split, which at
  // least answers a real question ("how many states deduct every payroll
  // cycle vs. half-yearly/annually").
  const monthlyCount = rows.filter((r) => (r.frequency ?? "").toLowerCase() === "monthly").length;
  const otherFrequencyCount = rows.length - monthlyCount;

  // GAP-PAYROLL-STATUTORY-LWF-06: labels for payroll-service's LWF_FREQUENCIES
  // (modules/payroll/state-rules.ts). Precomputed into a plain field rather
  // than a column `render` function, which cannot cross from this Server
  // Component into the client DataTable.
  const FREQUENCY_LABELS: Record<string, string> = {
    monthly: t("frequencyMonthly"),
    quarterly: t("frequencyQuarterly"),
    half_yearly: t("frequencyHalfYearly"),
    yearly: t("frequencyYearly"),
  };
  const displayRows = rows.map((r) => ({
    ...r,
    frequencyLabel: FREQUENCY_LABELS[(r.frequency ?? "").toLowerCase()] ?? r.frequency,
  }));
  type LwfDisplayRow = (typeof displayRows)[number];

  const columns: { key: keyof LwfDisplayRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "state_code", label: t("colState") },
    { key: "employee_contrib_minor", label: t("colEmployeeContribution"), align: "right", cellType: "amount" },
    { key: "employer_contrib_minor", label: t("colEmployerContribution"), align: "right", cellType: "amount" },
    // GAP-PAYROLL-STATUTORY-LWF-06: the raw backend enum ("monthly",
    // "half_yearly", ...) used to print unchanged; map to a readable label
    // and fall back to the raw string for any value not in the map.
    { key: "frequencyLabel", label: t("colFrequency") },
  ];

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("errorBackLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      <StatGrid>
        <StatCard icon="🤝" iconBg="var(--infobg)" label={t("statStatesConfigured")} value={errored ? null : rows.length} />
        <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statMonthlyFrequencyCount")} value={errored ? null : monthlyCount} />
        <StatCard icon="🗓️" iconBg="var(--warnbg)" label={t("statOtherFrequencyCount")} value={errored ? null : otherFrequencyCount} />
      </StatGrid>

      {/* GAP-PAYROLL-STATUTORY-LWF-05: existing rows are passed in so the
          form can warn before overwriting a state's stored configuration. */}
      {canEdit && <LwfConfigForm existingConfigs={errored ? [] : rows.map((r) => ({ state_code: r.state_code }))} />}

      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <DataTable<LwfDisplayRow>
          columns={columns}
          rows={displayRows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🤝"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
