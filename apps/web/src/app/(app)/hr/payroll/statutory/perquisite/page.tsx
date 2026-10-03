import { getTranslations } from "next-intl/server";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, RefreshErrorState, Masked } from "../../../../../_components/ds";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYROLL_STATUTORY_ADMIN_ROLES, PAYROLL_STATUTORY_WRITE_ROLES } from "@/lib/auth/workRoles";
import { EmployeeFyLookup } from "./EmployeeFyLookup";
import { PerquisiteComponentForm } from "./PerquisiteComponentForm";
import { PerquisiteTable } from "./PerquisiteTable";

type PerquisiteLine = {
  sl: number;
  id?: string;
  nature: string;
  description?: string;
  valueByEmployerMinor?: number;
  amountRecoveredMinor?: number;
  taxableValueMinor: number;
  value: number;
};

type Form12BAResponse = {
  formType: string;
  fy: string;
  assessmentYear: string;
  employer: { name: string; tan: string; pan: string };
  employee: { employeeId: string; pan: string; name: string; panFlag: string };
  perquisites: PerquisiteLine[];
  totalPerquisitesMinor: number;
  totalPerquisites: number;
  note: string;
};

async function getForm12BA(employeeId: string, fy: string): Promise<LoaderResult<Form12BAResponse | null>> {
  return fetchJson<Form12BAResponse, Form12BAResponse | null>(
    `/api/v1/payroll/statutory/form12ba?employeeId=${encodeURIComponent(employeeId)}&fy=${encodeURIComponent(fy)}`,
    null,
    {
      telemetryKey: "payroll.statutory.form12ba",
      mapResponse: (p) => (p && Array.isArray(p.perquisites) ? p : null),
    },
  );
}

export default async function PerquisitePage({ searchParams }: { searchParams?: { employeeId?: string; fy?: string; edit?: string } }) {
  const t = await getTranslations("perquisite");

  // GAP-PAYROLL-STATUTORY-PERQUISITE-02/04: GET form12ba is self-service-
  // scoped server-side (enforceEmployeeOwnership -- an "employee" caller can
  // only ever fetch their OWN record), but this page's UI is an admin lookup
  // of an ARBITRARY typed-in employeeId plus an admin-only add-component
  // form (POST perquisite-components requires payroll_admin/payroll_officer/
  // super_admin -- statutory-returns/routes.ts's STATUTORY_ROLES, no
  // "employee" at all). Gating at PAYROLL_STATUTORY_ADMIN_ROLES (the
  // privileged tier common to both reads and writes here) avoids inviting
  // self-service use of a tool that isn't built for it, rather than widening
  // to match the narrowest individual endpoint.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_STATUTORY_ADMIN_ROLES.includes(r))) {
    return <PermissionDenied module="Form 12BA / perquisites" requiredRoles={PAYROLL_STATUTORY_ADMIN_ROLES} backHref="/hr/payroll/statutory" backLabel={t("errorBackLabel")} />;
  }

  const employeeId = searchParams?.employeeId?.trim();
  const fy = searchParams?.fy?.trim();
  const canLookup = !!employeeId && !!fy;

  const result = canLookup ? await getForm12BA(employeeId!, fy!) : null;
  const source = result?.source;
  const status = result?.status;
  const form12ba = result?.data ?? null;
  // GAP-PAYROLL-STATUTORY-PERQUISITE-06: ?edit=<component id> re-opens the form on that line.
  const editLine = searchParams?.edit ? form12ba?.perquisites.find((p) => p.id === searchParams.edit) : undefined;
  const perqCount = form12ba?.perquisites?.length ?? 0;
  const totalPerqMinor = form12ba?.totalPerquisitesMinor ?? 0;
  const maxPerqMinor = form12ba && form12ba.perquisites.length > 0
    ? Math.max(...form12ba.perquisites.map((p) => p.taxableValueMinor))
    : 0;
  // GAP-PAYROLL-STATUTORY-PERQUISITE-01: fetchJson returns data:null for
  // BOTH a real "no Form 12BA for this employee/FY" and any fetch error
  // (source:"error") -- a null `form12ba` alone can't tell them apart, so an
  // outage used to render the same "No Form 12BA data" EmptyState as a
  // genuine empty result, with no retry. A 404 is a legitimate empty result
  // (not every employee/FY has perquisites on file); any OTHER error status
  // (or no status at all, e.g. a network failure) gets the real error state.
  const isLoadError = canLookup && source === "error" && status !== 404;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll/statutory" backLabel={t("errorBackLabel")}
      />
      {canLookup && !isLoadError && <DataSourceBadge source={source === "error" ? "error" : "api"} message={t("loadErrorMessage")} />}

      {canLookup && form12ba && (
        <StatGrid>
          <StatCard icon="📋" iconBg="var(--infobg)" label={t("statPerquisiteItems")} value={perqCount} />
          <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statTotalTaxableValue")} value={formatMoney(totalPerqMinor)} />
          <StatCard icon="📈" iconBg="var(--warnbg)" label={t("statLargestPerquisite")} value={formatMoney(maxPerqMinor)} />
          <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statFinancialYear")} value={form12ba.fy} />
        </StatGrid>
      )}

      <EmployeeFyLookup employeeId={employeeId ?? ""} fy={fy ?? ""} />

      <PerquisiteComponentForm
        key={editLine?.id ?? "new"}
        defaultEmployeeId={employeeId ?? ""}
        defaultFy={fy ?? ""}
        editing={editLine ? {
          nature: editLine.nature,
          description: editLine.description ?? "",
          valueByEmployerMinor: String(editLine.valueByEmployerMinor ?? 0),
          amountRecoveredMinor: String(editLine.amountRecoveredMinor ?? 0),
        } : undefined}
      />

      <Card title={t("form12baCardTitle")}>
        {!canLookup ? (
          <EmptyState
            icon="📄"
            title={t("selectEmployeeFyTitle")}
            message={t("selectEmployeeFyMessage")}
          />
        ) : isLoadError ? (
          <RefreshErrorState error={toHumanError("load", { area: t("loadErrorArea") })} backHref="/hr/payroll/statutory" />
        ) : !form12ba ? (
          <EmptyState
            icon="📄"
            title={t("noForm12baTitle")}
            message={t("noForm12baMessage", { fy: fy ?? "" })}
          />
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("employerLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employer.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("employerTanLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employer.tan}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("assessmentYearLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.assessmentYear}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("employeeLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{form12ba.employee.name || form12ba.employee.employeeId}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("panLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  <Masked value={form12ba.employee.pan} kind="pan" fallback={form12ba.employee.panFlag} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{t("totalPerquisitesLabel")}</div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{formatMoney(form12ba.totalPerquisitesMinor)}</div>
              </div>
            </div>
            <PerquisiteTable perquisites={form12ba.perquisites} employeeId={form12ba.employee.employeeId || (employeeId ?? "")} fy={form12ba.fy} canModify={roles.some((r) => (PAYROLL_STATUTORY_WRITE_ROLES as readonly string[]).includes(r))} />
            <p style={{ fontSize: 12, color: "var(--ink2)" }}>{form12ba.note}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
