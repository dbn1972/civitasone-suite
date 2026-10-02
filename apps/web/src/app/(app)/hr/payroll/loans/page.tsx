import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState, RefreshErrorState, type EntityOption } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { formatMoney } from "@/lib/formatters";
import { getSessionRoles, getSessionUserId, PAYROLL_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { LoanSearchForm } from "./LoanSearchForm";
import { CreateLoanForm } from "./CreateLoanForm";
import { LoansTable, type LoanRow } from "./LoansTable";
import { computeLoanStats } from "./loanStats";
import { toHumanError } from "@/lib/messages";
import { mapLoanSchedule, pickScheduleLoan, type ScheduleInstallment } from "./loanSchedule";

/**
 * GAP-PAYROLL-LOANS-02: who may open this page. Mirrors payroll-service
 * loans/routes.ts READER_ROLES minus the self-service "employee" role -- this
 * is an officer's search-any-employee tool, and a self-service employee can
 * only ever read their own loans there. hr/layout.tsx otherwise admits
 * manager/employee to every /hr/payroll* route.
 */
const LOANS_VIEW_ROLES = [...PAYROLL_ADMIN_ROLES, "hr_admin"];

type EmployeeRow = { id: string; name?: string; employeeNo?: string; department?: string };

async function getLoans(empId: string): Promise<LoaderResult<LoanRow[]>> {
  return fetchJson<unknown, LoanRow[]>(`/api/v1/payroll/loans?empId=${encodeURIComponent(empId)}`, [], {
    telemetryKey: "payroll.loans",
    mapResponse: (p) => (Array.isArray(p) ? (p as LoanRow[]) : null),
  });
}

async function getSchedule(loanId: string): Promise<LoaderResult<ScheduleInstallment[]>> {
  return fetchJson<unknown, ScheduleInstallment[]>(`/api/v1/payroll/loans/${encodeURIComponent(loanId)}/schedule`, [], {
    telemetryKey: "payroll.loans.schedule",
    mapResponse: mapLoanSchedule,
  });
}

/**
 * GAP-PAYROLL-LOANS-01: name the searched employee (name + employee code)
 * so the result can be checked against the person intended. Same
 * GET /v1/hrms/employees?ids= lookup as hr/icc/[id]/page.tsx resolveNames.
 */
async function getEmployeeOption(empId: string): Promise<EntityOption | null> {
  const { data } = await fetchJson<unknown, EmployeeRow[]>(
    `/api/v1/hrms/employees?ids=${encodeURIComponent(empId)}`,
    [],
    {
      telemetryKey: "payroll.loans_employee",
      mapResponse: (p) => {
        const body = p as { data?: EmployeeRow[] } | EmployeeRow[];
        const arr = Array.isArray(body) ? body : body?.data;
        return Array.isArray(arr) ? arr : null;
      },
    },
  );
  const row = data.find((e) => e.id === empId);
  if (!row?.name) return null;
  return {
    id: row.id,
    label: row.employeeNo ? `${row.name} (${row.employeeNo})` : row.name,
    sublabel: row.department,
  };
}

export default async function LoansPage({
  searchParams,
}: {
  searchParams: { empId?: string; loanId?: string };
}) {
  const t = await getTranslations("payrollLoans");
  const roles = getSessionRoles();
  if (!roles.some((r) => LOANS_VIEW_ROLES.includes(r))) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel="Back to Payroll" />
        <PermissionDenied module="employee loans" requiredRoles={LOANS_VIEW_ROLES} />
      </div>
    );
  }
  // Create / disburse are payroll-admin only (payroll-service loans/routes.ts
  // PAYROLL_ROLES); hr_admin gets a read-only view.
  const canManage = roles.some((r) => PAYROLL_ADMIN_ROLES.includes(r));
  const currentUserId = getSessionUserId();

  const empId = searchParams?.empId?.trim() || "";
  const [result, employee] = empId
    ? await Promise.all([getLoans(empId), getEmployeeOption(empId)])
    : [{ data: [], source: "api" } as LoaderResult<LoanRow[]>, null];
  const errored = result.source === "error";
  const loans = result.data;
  // GAP-PAYROLL-LOANS-06: real per-installment schedule for one of THIS
  // employee's loans (never an id taken blindly from the URL).
  const scheduleLoan = !errored && empId ? pickScheduleLoan(loans, searchParams?.loanId?.trim()) : null;
  const schedule = scheduleLoan ? await getSchedule(scheduleLoan.id) : null;
  const stats = computeLoanStats(loans);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/payroll" backLabel="Back to Payroll"
      />
      {empId && <DataSourceBadge source={result.source} message={t("loadErrorMessage")} />}

      {empId && (
        <StatGrid>
          <StatCard icon="💳" iconBg="var(--infobg)" label={t("statTotalLoans")} value={errored ? null : stats.total} />
          <StatCard icon="✅" iconBg="var(--goodbg)" label={t("statActiveDisbursed")} value={errored ? null : stats.active} />
          <StatCard icon="⏳" iconBg="var(--infobg)" label={t("statPendingDisbursement")} value={errored ? null : stats.pending} />
          <StatCard icon="💰" iconBg="var(--warnbg)" label={t("statTotalOutstanding")} value={errored ? null : formatMoney(stats.outstandingMinor)} />
          <StatCard icon="📅" iconBg="var(--goodbg)" label={t("statMonthlyEmiTotal")} value={errored ? null : formatMoney(stats.monthlyEmiMinor)} />
        </StatGrid>
      )}

      <Card title={t("searchCardTitle")} padding>
        <LoanSearchForm initialEmpId={empId} initialEmployee={employee ?? undefined} />
      </Card>

      {canManage && <CreateLoanForm currentEmpId={empId} />}

      <Card
        title={
          empId
            ? employee
              ? t("loansCardTitleFor", { employee: employee.label })
              : t("loansCardTitleUnknown")
            : t("loansCardTitle")
        }
      >
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "loans" })} backHref="/hr/payroll" />
          </div>
        ) : (<>

        {!empId ? (
          <EmptyState
            icon="🔎"
            title={t("searchEmptyTitle")}
            message={t("searchEmptyMessage")}
          />
        ) : (
          <LoansTable rows={loans} canDisburse={canManage} currentUserId={currentUserId} />
        )}
        </>)}
        </Card>

      {scheduleLoan && schedule && (
        <Card title={t("recoveryCardTitleFor", { loanNo: scheduleLoan.loanNo })}>
          {loans.length > 1 && (
            <nav aria-label={t("recoveryPickLoanLabel")} style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "0 16px 12px" }}>
              {loans.map((l) => (
                <Link
                  key={l.id}
                  href={`/hr/payroll/loans?empId=${encodeURIComponent(empId)}&loanId=${encodeURIComponent(l.id)}`}
                  aria-current={l.id === scheduleLoan.id ? "true" : undefined}
                  style={{ fontWeight: l.id === scheduleLoan.id ? 700 : 400, textDecoration: l.id === scheduleLoan.id ? "none" : "underline" }}
                >
                  {l.loanNo}
                </Link>
              ))}
            </nav>
          )}
          {schedule.source === "error" ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "loan schedule" })} backHref="/hr/payroll" />
            </div>
          ) : (
            <>
              <p style={{ margin: "0 16px 8px", fontSize: 12, color: "var(--ink2)" }}>{t("recoveryNote")}</p>
              <DataTable<ScheduleInstallment>
                columns={[
                  { key: "installmentNo", label: t("recoveryColNo"), align: "right" },
                  { key: "openingMinor", label: t("recoveryColOpening"), align: "right", cellType: "amount" },
                  { key: "emiMinor", label: t("recoveryColEmi"), align: "right", cellType: "amount" },
                  { key: "principalMinor", label: t("recoveryColPrincipal"), align: "right", cellType: "amount" },
                  { key: "interestMinor", label: t("recoveryColInterest"), align: "right", cellType: "amount" },
                  { key: "closingMinor", label: t("recoveryColClosing"), align: "right", cellType: "amount" },
                ]}
                rows={schedule.data}
                pageSize={12}
                emptyIcon="📅"
                emptyTitle={t("recoveryEmptyTitle")}
                emptyMessage={t("recoveryEmptyMessage")}
              />
            </>
          )}
        </Card>
      )}
    </div>
  );
}
