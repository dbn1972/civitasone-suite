import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { formatMoney } from "@/lib/formatters";
import { EcrGeneratorForm } from "./EcrGeneratorForm";
import { toHumanError } from "@/lib/messages";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { getSessionRoles, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES } from "@/lib/auth/workRoles";
import { StatutoryPeriodPicker } from "../_components/StatutoryPeriodPicker";
import { loadLedgerPeriod } from "../_lib/ledgerPeriod";
import { employeeLabel } from "../_lib/employeeLabel";

type PfRow = {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  /** Display-only: see employeeLabel() -- never the full UUID. */
  employee?: string;
  period: string;
  basicMinor: number;
  empContribMinor: number;
  erContribMinor: number;
} & Record<string, unknown>;

export default async function PfStatutoryPage({ searchParams }: { searchParams?: { period?: string } }) {
  const t = await getTranslations("pf");
  // GAP-PAYROLL-STATUTORY-PF-01: hr/layout.tsx admits employee/manager to every /hr/payroll/*
  // URL, but this page's API (PF ledger) is READER_ROLES-only in
  // payroll-service (no employee/manager). Gate before fetching so those
  // roles get a clear explanation instead of a failed load.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="PF ledger" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }
  // GAP-PAYROLL-STATUTORY-PF-01: the ECR export (GET statutory/ecr) is STATUTORY_ROLES-only
  // (payroll_admin/payroll_officer/super_admin) -- narrower than the ledger read.
  const canEdit = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  // GAP-PAYROLL-STATUTORY-PF-03 [HUMAN REVIEW: statutory compliance]: PF is
  // filed/paid per month. The stat tiles used to sum whatever unordered first
  // page (50 rows) of the whole ledger the API returned, labelled as one
  // month. They now come from payroll-service's per-period SQL summary (every
  // row of the selected period, latest by default), and the table asks for
  // exactly that period.
  const ledger = await loadLedgerPeriod<PfRow>("pf", searchParams?.period);
  const source = ledger.source;
  const errored = source === "error";
  const periods = ledger.summary?.periods ?? [];
  const selectedPeriod = ledger.summary?.period ?? undefined;
  const periodRows = ledger.rows.map((r) => ({ ...r, employee: employeeLabel(r.employeeId, r.employeeName) }));
  const recordCount = ledger.summary?.recordCount ?? 0;
  const totalEmpContribMinor = ledger.summary?.empContribMinor ?? "0";
  const totalErContribMinor = ledger.summary?.erContribMinor ?? "0";
  const totalPfMinor = ledger.summary?.totalContribMinor ?? "0";

  const columns: {
    key: keyof PfRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
  }[] = [
    // GAP-PAYROLL-STATUTORY-PF-04: show the employee's name (already optional
    // on the shared row shape) with the raw id only as a last-resort fallback
    // -- never the bare UUID when a name is available.
    { key: "employee", label: t("colEmployee") },
    { key: "period", label: t("colPeriod") },
    { key: "basicMinor", label: t("colBasic"), align: "right", cellType: "amount" },
    { key: "empContribMinor", label: t("colEmployeePf"), align: "right", cellType: "amount" },
    { key: "erContribMinor", label: t("colEmployerPf"), align: "right", cellType: "amount" },
  ];

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("errorBackLabel")}
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {!errored && (
        <StatutoryPeriodPicker
          periods={periods}
          selected={selectedPeriod}
          basePath="/hr/payroll/statutory/pf"
          label={t("selectPeriodLabel")}
        />
      )}

      <StatGrid>
        <StatCard icon="🏦" iconBg="var(--infobg)" label={t("statPfRecords")} value={errored ? null : recordCount} />
        <StatCard icon="👤" iconBg="var(--goodbg)" label={t("statTotalEmployeeContribution")} value={errored ? null : formatMoney(totalEmpContribMinor)} />
        <StatCard icon="🏢" iconBg="var(--warnbg)" label={t("statTotalEmployerContribution")} value={errored ? null : formatMoney(totalErContribMinor)} />
        <StatCard icon="💵" iconBg="var(--panel)" label={t("statTotalPfContribution", { period: selectedPeriod ?? "—" })} value={errored ? null : formatMoney(totalPfMinor)} />
      </StatGrid>

      {canEdit && <EcrGeneratorForm />}

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
          <DataTable<PfRow>
          columns={columns}
          rows={periodRows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          emptyIcon="🏦"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
          </>
        )}
      </Card>
    </div>
  );
}
