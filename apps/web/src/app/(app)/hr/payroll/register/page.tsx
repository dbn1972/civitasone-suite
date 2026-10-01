import Link from "next/link";
import { Button, PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles, PAYROLL_REPORT_ROLES } from "@/lib/auth/roleGuard";
import { PERIOD_PATTERN, parsePeriodParam } from "@/lib/payroll/period";
import { sumMinor, toMinorBigInt } from "@/lib/payroll/money";
import { getTranslations } from "next-intl/server";

/**
 * One payroll.payroll_register row (payroll-service world-class-routes.ts
 * GET /v1/payroll/register). Every `*_minor` field is PAISE (BIGINT, sent as
 * an integer string) -- unlike /hr/payroll, /runs, /period and /[id], whose
 * run-level amounts are rupees (GAP-PAYROLL-REGISTER-01).
 */
type Row = {
  id: string;
  department_name: string | null;
  employee_count: number | string;
  total_gross_minor: number | string;
  total_deductions_minor: number | string;
  total_net_minor: number | string;
  total_pf_minor: number | string;
  total_esi_minor: number | string;
  total_tds_minor: number | string;
  total_pt_minor: number | string;
  period: string;
} & Record<string, unknown>;

type DisplayRow = Row & {
  departmentLabel: string;
  otherDeductionsMinor: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getData(period?: string, runId?: string): Promise<LoaderResult<Row[]>> {
  const qs = new URLSearchParams();
  if (period) qs.set("period", period);
  if (runId) qs.set("runId", runId);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return fetchJson<unknown, Row[]>(`/api/v1/payroll/register${suffix}`, [], {
    telemetryKey: "payroll.register",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

/**
 * GAP-PAYROLL-REGISTER-04: the register table has no GPF/NPS columns
 * (payroll.payroll_register only stores PF/ESI/TDS/PT totals), so a Govt
 * department's GPF/NPS deductions were invisible inside "Deductions". Show
 * the remainder explicitly so the split always adds up.
 */
function otherDeductions(r: Row): string | null {
  const total = toMinorBigInt(r.total_deductions_minor);
  const listed = sumMinor([r.total_pf_minor, r.total_esi_minor, r.total_tds_minor, r.total_pt_minor]);
  if (total === null || listed === null) return null;
  return (total - listed).toString();
}

export default async function PayrollRegisterPage({
  searchParams,
}: {
  searchParams?: { period?: string; runId?: string };
}) {
  const t = await getTranslations("payrollRegister");

  // GAP-PAYROLL-REGISTER-05: department-wise salary totals were reachable by
  // every role hr/layout.tsx admits (incl. employee/manager). Gate on the
  // backend's own role list and make no fetch otherwise.
  const roles = getSessionRoles();
  if (!roles.some((r) => PAYROLL_REPORT_ROLES.includes(r))) {
    return (
      <div className="page-main wrap">
        <PermissionDenied module="the payroll register" requiredRoles={PAYROLL_REPORT_ROLES} backHref="/hr/payroll" backLabel={t("backLabel")} />
      </div>
    );
  }

  // GAP-PAYROLL-REGISTER-03: validate the filters server-side; an invalid
  // value is shown as an error and never sent to the API.
  const periodParam = parsePeriodParam(searchParams?.period);
  const rawRunId = searchParams?.runId?.trim() || "";
  const runIdInvalid = rawRunId !== "" && !UUID_RE.test(rawRunId);
  const period = periodParam.state === "valid" ? periodParam.period : undefined;
  const runId = rawRunId && !runIdInvalid ? rawRunId : undefined;
  const filterInvalid = periodParam.state === "invalid" || runIdInvalid;

  const [registerResult, runsResult] = await Promise.all([
    filterInvalid ? Promise.resolve<LoaderResult<Row[]>>({ data: [], source: "api" }) : getData(period, runId),
    getPayrollRunDetails({ limit: 24 }),
  ]);
  const { data: items, source } = registerResult;
  const errored = source === "error";
  const runs = runsResult.source === "error" ? [] : runsResult.data;
  const selectedRun = runId ? runs.find((r) => r.id === runId) : undefined;

  const rows: DisplayRow[] = items.map((r) => ({
    ...r,
    departmentLabel: r.department_name?.trim() || t("unassigned"),
    otherDeductionsMinor: otherDeductions(r),
  }));

  // GAP-PAYROLL-REGISTER-02: an unfiltered load returns every period, and
  // summing employee_count across months counted the same staff once per
  // month. Stats are always scoped to ONE period: the filtered one, or the
  // latest period present in the result.
  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const statsPeriod = period ?? (periods.length > 0 ? periods[periods.length - 1] : undefined);
  const statRows = statsPeriod ? rows.filter((r) => r.period === statsPeriod) : rows;
  const multiPeriod = periods.length > 1;

  const departmentCount = new Set(statRows.map((r) => r.departmentLabel)).size;
  const employeeTotal = sumMinor(statRows.map((r) => r.employee_count));
  // GAP-PAYROLL-REGISTER-01: exact bigint paise sums, never Number().
  const totalGrossMinor = sumMinor(statRows.map((r) => r.total_gross_minor));
  const totalNetMinor = sumMinor(statRows.map((r) => r.total_net_minor));

  const columns: {
    key: keyof DisplayRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "amount";
  }[] = [
    { key: "departmentLabel", label: t("colDepartment") },
    { key: "employee_count", label: t("colEmployees"), align: "right" },
    { key: "total_gross_minor", label: t("colGross"), align: "right", cellType: "amount" },
    { key: "total_deductions_minor", label: t("colDeductions"), align: "right", cellType: "amount" },
    { key: "total_net_minor", label: t("colNet"), align: "right", cellType: "amount" },
    { key: "total_pf_minor", label: t("colPf"), align: "right", cellType: "amount" },
    { key: "total_esi_minor", label: t("colEsi"), align: "right", cellType: "amount" },
    { key: "total_tds_minor", label: t("colTds"), align: "right", cellType: "amount" },
    { key: "total_pt_minor", label: t("colPt"), align: "right", cellType: "amount" },
    { key: "otherDeductionsMinor", label: t("colOtherDeductions"), align: "right", cellType: "amount" },
    { key: "period", label: t("colPeriod") },
  ];

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 } as const;
  const hasActiveFilter = !!period || !!runId;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel={t("backLabel")}
      />

      <Card title={t("filterCardTitle")} padding>
        <form method="get" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="reg-period" style={{ fontSize: 13, fontWeight: 600 }}>{t("labelPeriod")}</label>
            <input
              id="reg-period"
              name="period"
              type="month"
              pattern={PERIOD_PATTERN}
              defaultValue={period ?? (periodParam.state === "invalid" ? periodParam.raw : "")}
              placeholder="2025-06"
              aria-invalid={periodParam.state === "invalid" || undefined}
              aria-describedby={periodParam.state === "invalid" ? "reg-period-err" : undefined}
              style={inputStyle}
            />
            {periodParam.state === "invalid" && (
              <p id="reg-period-err" role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>
                {t("periodInvalidError", { value: periodParam.raw })}
              </p>
            )}
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor="reg-run-id" style={{ fontSize: 13, fontWeight: 600 }}>{t("labelRun")}</label>
            <select
              id="reg-run-id"
              name="runId"
              defaultValue={runId ?? ""}
              aria-invalid={runIdInvalid || undefined}
              aria-describedby={runIdInvalid ? "reg-run-err" : undefined}
              style={{ ...inputStyle, background: "var(--panel, #fff)" }}
            >
              <option value="">{t("allRunsOption")}</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{t("runOption", { period: r.payPeriod, count: r.employeeCount })}</option>
              ))}
              {runId && !selectedRun && <option value={runId}>{runId}</option>}
            </select>
            {runIdInvalid && (
              <p id="reg-run-err" role="alert" className="pill bad" style={{ width: "fit-content", margin: 0 }}>
                {t("runIdInvalidError")}
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <Button type="submit" style={{ minHeight: 44 }}>{t("applyFilter")}</Button>
          </div>
        </form>
        {hasActiveFilter && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }} aria-label={t("activeFiltersLabel")}>
            {period && <span className="pill info">{t("chipPeriod", { period })}</span>}
            {runId && <span className="pill info">{t("chipRun", { period: selectedRun?.payPeriod ?? runId })}</span>}
            <Link href="/hr/payroll/register" style={{ fontSize: 13, minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              {t("clearFilters")}
            </Link>
          </div>
        )}
      </Card>

      <StatGrid>
        <StatCard icon="🏢" iconBg="var(--infobg)" label={t("statDepartments")} value={errored ? null : departmentCount} />
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployees")} value={errored || employeeTotal === null ? null : Number(employeeTotal)} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")} value={errored ? null : formatMoney(totalGrossMinor)} />
        <StatCard icon="🧾" iconBg="var(--warnbg)" label={t("statNet")} value={errored ? null : formatMoney(totalNetMinor)} />
      </StatGrid>
      {!errored && multiPeriod && statsPeriod && (
        <p role="note" style={{ fontSize: 13, color: "var(--mut)", margin: "-4px 0 12px" }}>
          {t("statsScopedNote", { period: statsPeriod })}
        </p>
      )}

      <Card title={t("cardTitle")}>
        {errored ? (
          <div className="pad">
            {/* GAP-PAYROLL-REGISTER-06: one error message, not a badge AND an error state. */}
            <RefreshErrorState error={toHumanError("load", { area: "register" })} backHref="/hr/payroll" />
          </div>
        ) : (
          <DataTable<DisplayRow>
          columns={columns}
          rows={rows}
          caption={t("tableCaption")}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          exportable
          exportFilename={`payroll-register${statsPeriod ? `-${statsPeriod}` : ""}`}
          emptyIcon="📋"
          emptyTitle={t("emptyTitle")}
          emptyMessage={t("emptyMessage")}
        />
        )}
      </Card>
    </div>
  );
}
