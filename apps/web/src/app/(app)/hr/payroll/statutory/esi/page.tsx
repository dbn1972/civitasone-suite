import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { StatutoryPeriodPicker } from "../_components/StatutoryPeriodPicker";
import { loadLedgerPeriod } from "../_lib/ledgerPeriod";
import { employeeLabel } from "../_lib/employeeLabel";
import { ESI_WAGE_CEILING_MINOR, STATUTORY_REFERENCE_AS_OF } from "../_lib/rates";

type EsiRow = {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  /** Display-only: see employeeLabel() -- never the full UUID. */
  employee?: string;
  period: string;
  grossMinor: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

export default async function EsiStatutoryPage({ searchParams }: { searchParams?: { period?: string } }) {
  const t = await getTranslations("esi");
  // GAP-PAYROLL-STATUTORY-ESI-01: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API (ESI ledger) is READER_ROLES-only in
  // payroll-service (no employee/manager). Gate before fetching so those
  // roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="ESI ledger" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  // GAP-PAYROLL-STATUTORY-ESI-03 [HUMAN REVIEW: statutory compliance]: ESI is
  // filed/paid per month. The stat tiles used to sum whatever unordered first
  // page (50 rows) of the whole ledger the API returned, labelled as one
  // month. They now come from payroll-service's per-period SQL summary (every
  // row of the selected period, latest by default), and the table asks for
  // exactly that period.
  const ledger = await loadLedgerPeriod<EsiRow>("esi", searchParams?.period);
  const source = ledger.source;
  const errored = source === "error";
  const periods = ledger.summary?.periods ?? [];
  const selectedPeriod = ledger.summary?.period ?? undefined;
  const periodRows = ledger.rows.map((r) => ({ ...r, employee: employeeLabel(r.employeeId, r.employeeName) }));
  const recordCount = ledger.summary?.recordCount ?? 0;
  const totalEmpContribMinor = ledger.summary?.empContribMinor ?? "0";
  const totalErContribMinor = ledger.summary?.erContribMinor ?? "0";
  const totalEsiMinor = ledger.summary?.totalContribMinor ?? "0";

  const columns: {
    key: keyof EsiRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
  }[] = [
    // GAP-PAYROLL-STATUTORY-ESI-02: name over raw UUID whenever the backend
    // supplies one (now mirrored for ESI, same enrichment GPF/NPS already had
    // -- see statutory/queries.ts).
    { key: "employee", label: t("colEmployee") },
    { key: "period", label: t("colPeriod") },
    { key: "grossMinor", label: t("colGrossWages"), align: "right", cellType: "amount" },
    { key: "empContribMinor", label: t("colEmployeeEsi"), align: "right", cellType: "amount" },
    { key: "erContribMinor", label: t("colEmployerEsi"), align: "right", cellType: "amount" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("errorBackLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />
      {/* GAP-PAYROLL-STATUTORY-ESI-05: coverage hint from the same constant the hub uses. */}
      <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink2)" }}>
        {t("wageCeilingNote", { ceiling: formatMoney(ESI_WAGE_CEILING_MINOR), asOf: STATUTORY_REFERENCE_AS_OF })}
      </p>

      {!errored && (
        <StatutoryPeriodPicker
          periods={periods}
          selected={selectedPeriod}
          basePath="/hr/payroll/statutory/esi"
          label={t("selectPeriodLabel")}
        />
      )}

      <StatGrid>
        <StatCard icon="🩺" iconBg="var(--infobg)" label={t("statEsiRecords")} value={errored ? null : recordCount} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmployeeContribution")} value={errored ? null : formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={errored ? null : formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label={t("statTotalEsiContribution", { period: selectedPeriod ?? "—" })} value={errored ? null : formatMoney(totalEsiMinor)} />
      </StatGrid>
      <Card title={t("historyCardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll/statutory" />
          </div>
        ) : (
          <>
          {ledger.truncated && (
            <p role="status" style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink2)" }}>
              {t("truncatedNotice", { shown: periodRows.length, total: recordCount })}
            </p>
          )}
          <DataTable<EsiRow>
          columns={columns}
          rows={periodRows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🩺"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
          </>
        )}
      </Card>
    </div>
  );
}
