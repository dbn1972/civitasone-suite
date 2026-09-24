import { PageHeader, Card, DataTable, EmptyState, StatGrid, StatCard, RefreshErrorState } from "../../../_components/ds";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { useResource } from "@/app/_data/useResource";
import { toHumanError } from "@/lib/messages";
import { getTranslations } from "next-intl/server";

type EmpType = {
  id: string; code: string; name: string; description: string | null;
  eligibleForLeave: boolean; eligibleForPayroll: boolean; eligibleForAppraisal: boolean;
  defaultProbationMonths: number; maxContractMonths: number | null;
  payMode: string; isActive: boolean; sortOrder: number;
} & Record<string, unknown>;

async function getTypes(): Promise<LoaderResult<EmpType[]>> {
  const r = await fetchJson<unknown, EmpType[]>("/api/v1/hrms/employee-types", [], {
    telemetryKey: "config.employee_types",
    mapResponse: (p) => (p as { data: EmpType[] })?.data ?? null,
  });
  return r;
}

export default async function EmployeeTypesPage() {
  // Namespaced translator scoped to this page's copy only (UX-017). Note: the
  // row-mapping callbacks below use `et` (employee type), not `t`, for their
  // loop variable -- `t` here is this translator, and shadowing it inside
  // .filter()/.map() would silently break every t("...") call further down
  // the same closure chain (the exact class of bug tranche 2 found in
  // LeaveApprovalsPanel.tsx/balance/page.tsx).
  const t = await getTranslations("employeeTypes");
  const PAY_MODE_LABELS: Record<string, string> = {
    monthly: t("payModeMonthly"),
    hourly: t("payModeHourly"),
    consolidated: t("payModeConsolidated"),
    stipend: t("payModeStipend"),
    none: t("payModeNone"),
  };

  const result = await getTypes();
  const { data: types } = result;
  const resource = useResource(result);
  const errored = resource.status === "error";

  const active = errored ? null : types.filter((et) => et.isActive).length;
  const withPayroll = errored ? null : types.filter((et) => et.eligibleForPayroll).length;
  const inactive = errored ? null : types.filter((et) => !et.isActive).length;

  const rows = types.map((et) => ({
    ...et,
    payModeLabel: PAY_MODE_LABELS[et.payMode] ?? et.payMode,
    probation: et.defaultProbationMonths > 0 ? t("probationMonths", { months: et.defaultProbationMonths }) : t("probationNone"),
    contract: et.maxContractMonths ? t("contractMaxMonths", { months: et.maxContractMonths }) : t("contractUnlimited"),
    leave: et.eligibleForLeave ? "✅" : "—",
    payroll: et.eligibleForPayroll ? "✅" : "—",
    appraisal: et.eligibleForAppraisal ? "✅" : "—",
  }));

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="HR"
        help="hr"
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg, #e7edfd)" label={t("statTotalTypes")} value={errored ? "—" : types.length} />
        <StatCard icon="✅" iconBg="var(--goodbg, #ecfdf3)" label={t("statActive")} value={active ?? "—"} />
        <StatCard icon="💰" iconBg="var(--warnbg, #fffaeb)" label={t("statOnPayroll")} value={withPayroll ?? "—"} />
        <StatCard icon="🚫" iconBg="var(--badbg, #fdecea)" label={t("statInactive")} value={inactive ?? "—"} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "employee types" })} backHref="/hr" />
          </div>
        ) : types.length === 0 ? (
          <EmptyState
            icon="👥"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <DataTable
            columns={[
              { key: "code", label: t("colCode") },
              { key: "name", label: t("colName") },
              { key: "payModeLabel", label: t("colPayMode") },
              { key: "probation", label: t("colProbation") },
              { key: "contract", label: t("colMaxDuration") },
              { key: "leave", label: t("colLeave") },
              { key: "payroll", label: t("colPayroll") },
              { key: "appraisal", label: t("colAppraisal") },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder={t("filterPlaceholder")}
            emptyIcon="👥"
            emptyTitle={t("emptyFilteredTitle")}
            emptyMessage={t("emptyFilteredMessage")}
          />
        )}
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card padding>
          <h3 style={{ margin: "0 0 8px", fontSize: 15 }}>{t("aboutHeading")}</h3>
          <p style={{ margin: 0, color: "var(--mut)", fontSize: 13.5, lineHeight: 1.6 }}>
            {t("aboutIntro")}
          </p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink2)", fontSize: 13.5, lineHeight: 1.7 }}>
            <li><strong>{t("termPayMode")}</strong> {t("descPayMode")}</li>
            <li><strong>{t("termLeaveEligibility")}</strong> {t("descLeaveEligibility")}</li>
            <li><strong>{t("termPayroll")}</strong> {t("descPayroll")}</li>
            <li><strong>{t("termAppraisal")}</strong> {t("descAppraisal")}</li>
            <li><strong>{t("termMaxDuration")}</strong> {t("descMaxDuration")}</li>
          </ul>
          <p style={{ margin: "12px 0 0", color: "var(--mut)", fontSize: 12.5 }}>
            {t.rich("addTypesNoteRich", { code: (chunks) => <code>{chunks}</code> })}
          </p>
        </Card>
      </div>
    </div>
  );
}
