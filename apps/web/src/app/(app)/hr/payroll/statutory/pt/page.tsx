import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { PtSlabForm } from "./PtSlabForm";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";

type PtSlabRow = {
  state_code: string;
  slab_from_minor: number | string;
  slab_to_minor: number | string;
  pt_amount_minor: number | string;
} & Record<string, unknown>;

type StateRulesResponse = { ptSlabs?: PtSlabRow[]; lwfConfig?: unknown[] };

async function getData(): Promise<LoaderResult<PtSlabRow[]>> {
  return fetchJson<StateRulesResponse, PtSlabRow[]>("/api/v1/payroll/statutory/state-rules", [], {
    telemetryKey: "payroll.statutory.pt",
    mapResponse: (p) => (Array.isArray(p?.ptSlabs) ? p.ptSlabs! : null),
  });
}

export default async function ProfessionalTaxPage() {
  const t = await getTranslations("pt");
  // GAP-PAYROLL-STATUTORY-PT-01: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API (professional tax slabs) is READER_ROLES-only in
  // payroll-service (no employee/manager). Gate before fetching so those
  // roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="professional tax slabs" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  // GAP-PAYROLL-STATUTORY-PT-01: POST statutory/state-rules is PAYROLL_ROLES-only
  // (payroll_admin/payroll_officer/super_admin); hr_admin/finance_officer may read.
  const canEdit = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  const { data: rows, source } = await getData();
  const errored = source === "error";

  const statesCovered = new Set(rows.map((r) => r.state_code).filter(Boolean)).size;
  const maxPtMinor = rows.length > 0 ? Math.max(...rows.map((r) => Number(r.pt_amount_minor || 0))) : 0;
  const avgPtMinor = rows.length > 0 ? rows.reduce((s, r) => s + Number(r.pt_amount_minor || 0), 0) / rows.length : 0;

  const columns: { key: keyof PtSlabRow & string; label: string; align?: "left" | "right"; cellType?: "amount" }[] = [
    { key: "state_code", label: t("colState") },
    { key: "slab_from_minor", label: t("colSlabFrom"), align: "right", cellType: "amount" },
    { key: "slab_to_minor", label: t("colSlabTo"), align: "right", cellType: "amount" },
    { key: "pt_amount_minor", label: t("colPtAmount"), align: "right", cellType: "amount" },
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
        <StatCard icon="🏛️" iconBg="var(--infobg)" label={t("statPtSlabsConfigured")} value={errored ? null : rows.length} />
        <StatCard icon="🗺️" iconBg="var(--goodbg)" label={t("statStatesCovered")} value={errored ? null : statesCovered} />
        <StatCard icon="📈" iconBg="var(--warnbg)" label={t("statHighestPtAmount")} value={errored ? null : formatMoney(maxPtMinor)} />
        <StatCard icon="📊" iconBg="var(--goodbg)" label={t("statAvgPtPerSlab")} value={errored ? null : formatMoney(Math.round(avgPtMinor))} />
      </StatGrid>

      {canEdit && <PtSlabForm />}

      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "pt" })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <DataTable<PtSlabRow>
          columns={columns}
          rows={rows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
