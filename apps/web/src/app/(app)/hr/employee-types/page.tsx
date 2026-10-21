import { PageHeader, Card, EmptyState, StatGrid, StatCard, LoadErrorState } from "../../../_components/ds";
import { EmployeeTypesTable } from "./_components/EmployeeTypesTable";
import { humanizeStatus } from "@/lib/formatters";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "@/app/_components/PermissionDenied";
import { getTranslations } from "next-intl/server";
import { HR_MASTERS_ADMIN_ROLES } from "@/lib/auth/workRoles";

type EmpType = {
  id: string; code: string; name: string; description: string | null;
  eligibleForLeave: boolean; eligibleForPayroll: boolean; eligibleForAppraisal: boolean;
  defaultProbationMonths: number; maxContractMonths: number | null;
  payMode: string; category: string; paymentRoute: string; taxSection: string;
  statutoryPf: boolean; statutoryEsi: boolean; statutoryNps: boolean;
  eligibleForGratuity: boolean; eligibleForBonus: boolean; leaveEncashment: boolean;
  isActive: boolean; sortOrder: number;
} & Record<string, unknown>;

async function getTypes(): Promise<LoaderResult<EmpType[]>> {
  const r = await fetchJson<unknown, EmpType[]>("/api/v1/hrms/employee-types", [], {
    telemetryKey: "config.employee_types",
    mapResponse: (p) => (p as { data: EmpType[] })?.data ?? null,
  });
  return r;
}

/**
 * Mirrors employee-types-routes.ts's own HR_ROLES for POST/PATCH -- these
 * gate the "new"/"edit" actions added here (GAP-HR-EMPLOYEE-TYPES-01), not
 * who may view the list (see EMPLOYEE_TYPE_READ_ROLES below).
 */
const EMPLOYEE_TYPE_ADMIN_ROLES = HR_MASTERS_ADMIN_ROLES;

/**
 * GAP-HR-EMPLOYEE-TYPES-04: mirrors the backend GET guard
 * (employee-types-routes.ts EMPLOYEE_TYPE_READ_ROLES) 1:1, so a role the API
 * would 403 gets PermissionDenied before any fetch. hr_officer and the two
 * payroll roles were added to both sides: they run HR / payroll and need the
 * type flags; a plain employee still cannot read statutory configuration.
 */
const EMPLOYEE_TYPE_READ_ROLES = [...EMPLOYEE_TYPE_ADMIN_ROLES, "hr_officer", "manager", "officer", "payroll_admin", "payroll_officer"];

export default async function EmployeeTypesPage() {
  const roles = getSessionRoles();
  if (!roles.some((r: string) => EMPLOYEE_TYPE_READ_ROLES.includes(r))) {
    return <PermissionDenied module="employee types" requiredRoles={EMPLOYEE_TYPE_READ_ROLES} />;
  }
  const t = await getTranslations("employeeTypes");
  const PAY_MODE_LABELS: Record<string, string> = {
    monthly: t("payModeMonthly"),
    hourly: t("payModeHourly"),
    consolidated: t("payModeConsolidated"),
    stipend: t("payModeStipend"),
    none: t("payModeNone"),
  };
  const CATEGORY_LABELS: Record<string, string> = {
    pay_scale: t("category.pay_scale"),
    contractual: t("category.contractual"),
    consultant: t("category.consultant"),
    third_party: t("category.third_party"),
    apprentice: t("category.apprentice"),
    other: t("category.other"),
  };
  const PAYMENT_ROUTE_LABELS: Record<string, string> = {
    payroll: t("paymentRoute.payroll"),
    invoice: t("paymentRoute.invoice"),
    agency: t("paymentRoute.agency"),
    stipend: t("paymentRoute.stipend"),
    none: t("paymentRoute.none"),
  };

  const result = await getTypes();
  const { data: types } = result;
  const errored = result.source === "error";
  const canManage = roles.some((r: string) => EMPLOYEE_TYPE_ADMIN_ROLES.includes(r));

  const active = errored ? null : types.filter((et) => et.isActive).length;
  const withPayroll = errored ? null : types.filter((et) => et.eligibleForPayroll).length;
  const inactive = errored ? null : types.filter((et) => !et.isActive).length;

  const rows = types
    // GAP-HR-EMPLOYEE-TYPES-02: inactive types used to sort in wherever they
    // fell in the API's own order, indistinguishable from active ones in the
    // table. Pushing them last (stable within each group) makes the register
    // read as "current roster, then retired types" without hiding either.
    .slice()
    .sort((a, b) => Number(a.isActive === false) - Number(b.isActive === false) || a.sortOrder - b.sortOrder)
    .map((et) => {
      const statutory = [
        et.statutoryPf ? "PF" : null,
        et.statutoryEsi ? "ESI" : null,
        et.statutoryNps ? "NPS" : null,
      ].filter(Boolean).join(", ") || t("none");
      // GAP-HR-EMPLOYEE-TYPES-03: gratuity / bonus / leave encashment drive
      // statutory and payroll treatment but were only visible on the edit form
      // (and not at all to a viewer who cannot manage types). Same compact
      // "A, B" pattern as the Statutory column; "None" when no flag is on.
      const benefits = [
        et.eligibleForGratuity ? t("benefitGratuity") : null,
        et.eligibleForBonus ? t("benefitBonus") : null,
        et.leaveEncashment ? t("benefitLeaveEncashment") : null,
      ].filter(Boolean).join(", ") || t("none");
      return {
        id: et.id,
        code: et.code,
        name: et.name,
        description: et.description?.trim() ? et.description.trim() : null,
        // Server-safe row link (DataTable is a client component, so a rowHref function prop
        // cannot cross the RSC boundary): the full path, or "" when the viewer cannot manage.
        editHref: canManage ? `/hr/employee-types/${et.id}/edit` : "",
        // GAP-HR-EMPLOYEE-TYPES-05: an unlisted pay mode (legacy / unexpected data)
        // used to fall through as the raw code ("weekly"); humanize it instead.
        payModeLabel: PAY_MODE_LABELS[et.payMode] ?? (et.payMode ? humanizeStatus(et.payMode) : "—"),
        categoryLabel: CATEGORY_LABELS[et.category] ?? et.category,
        paymentRouteLabel: PAYMENT_ROUTE_LABELS[et.paymentRoute] ?? et.paymentRoute,
        taxSectionLabel: et.taxSection === "none" ? t("none") : et.taxSection,
        statutoryLabel: statutory,
        benefitsLabel: benefits,
        probation: et.defaultProbationMonths > 0 ? t("probationMonths", { months: et.defaultProbationMonths }) : t("probationNone"),
        contract: et.maxContractMonths ? t("contractMaxMonths", { months: et.maxContractMonths }) : t("contractUnlimited"),
        // GAP-HR-EMPLOYEE-TYPES-05: "✅"/"—" glyphs read to a screen reader as
        // "white heavy check mark"/"em dash" with no textual meaning. Plain
        // Yes/No carries the same information and is announced sensibly.
        leave: et.eligibleForLeave ? t("yes") : t("no"),
        payroll: et.eligibleForPayroll ? t("yes") : t("no"),
        appraisal: et.eligibleForAppraisal ? t("yes") : t("no"),
        statusLabel: et.isActive ? t("statusActive") : t("statusInactive"),
      };
    });

  return (
    <div className="page-main wrap">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr"
        backLabel="HR"
        help="hr"
        actions={canManage ? (
          <a href="/hr/employee-types/new" className="btn primary">{t("addTypeAction")}</a>
        ) : undefined}
      />

      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statTotalTypes")} value={errored ? "—" : types.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActive")} value={active ?? "—"} />
        <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statOnPayroll")} value={withPayroll ?? "—"} />
        <StatCard icon="🚫" iconBg="var(--badbg)" label={t("statInactive")} value={inactive ?? "—"} />
      </StatGrid>

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            <LoadErrorState result={result} area="employee types" backHref="/hr" />
          </div>
        ) : types.length === 0 ? (
          <EmptyState
            icon="👥"
            title={t("emptyTitle")}
            message={t("emptyMessage")}
          />
        ) : (
          <EmployeeTypesTable
            rows={rows}
            labels={{
              colCode: t("colCode"),
              colName: t("colName"),
              colStatus: t("colStatus"),
              colPayMode: t("colPayMode"),
              colCategory: t("colCategory"),
              colPaymentRoute: t("colPaymentRoute"),
              colTaxSection: t("colTaxSection"),
              colStatutory: t("colStatutory"),
              colBenefits: t("colBenefits"),
              colProbation: t("colProbation"),
              colMaxDuration: t("colMaxDuration"),
              colLeave: t("colLeave"),
              colPayroll: t("colPayroll"),
              colAppraisal: t("colAppraisal"),
              filterPlaceholder: t("filterPlaceholder"),
              emptyFilteredTitle: t("emptyFilteredTitle"),
              emptyFilteredMessage: t("emptyFilteredMessage"),
            }}
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
            {t("addTypesNote")}
          </p>
        </Card>
      </div>
    </div>
  );
}
