import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatGrid, StatCard } from "../../../../_components/ds";
import { getPayrollRunById, getPayrollRunDetails } from "../../../../_data/loaders";
import { formatRupees, formatIndianDate } from "@/lib/formatters";
import { PayrollRunActions } from "./PayrollRunActions";
import { PayrollRunStepper } from "./PayrollRunStepper";
import { MonthOverMonthCards } from "./MonthOverMonthCards";
import { ExceptionPanel, deriveExceptions } from "./ExceptionPanel";
import { SalarySlipsClientTable } from "./SalarySlipsClientTable";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

type SalarySlipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  gross: number;
  deductions: number;
  net: number;
  status: string;
} & Record<string, unknown>;

/** Parse a pay-period string like "2026-07" or "July 2026" → { year, month } */
function parsePeriod(pp: string): { year: number; month: number } | null {
  const iso = /^(\d{4})-(\d{2})$/.exec(pp);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
  const d = new Date(`1 ${pp}`);
  if (!isNaN(d.getTime())) return { year: d.getFullYear(), month: d.getMonth() + 1 };
  return null;
}

function prevPeriodLabel(pp: string): string {
  const parsed = parsePeriod(pp);
  if (!parsed) return "Previous month";
  const d = new Date(parsed.year, parsed.month - 2, 1);
  return d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** ISO ("YYYY-MM") of the month immediately before `pp`, or null if unparseable. */
function prevPeriodIso(pp: string): string | null {
  const parsed = parsePeriod(pp);
  if (!parsed) return null;
  const prevMonth = parsed.month === 1 ? 12 : parsed.month - 1;
  const prevYear  = parsed.month === 1 ? parsed.year - 1 : parsed.year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

export default async function PayrollRunDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("payrollDetail");
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => ["payroll_admin", "payroll_officer", "super_admin"].includes(r));
  const { data: run, source } = await getPayrollRunById(params.id);

  if (!run) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title={t("titleFallback")} back="/hr/payroll" backLabel="Payroll Runs" />
        <DataSourceBadge source={source} message={t("loadErrorMessage")} />
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0" }}>
            {t("notFound")}
          </p>
        </Card>
      </div>
    );
  }

  // HIGH fix (fix/high-data-issues): this used to fetch every payroll run
  // for the tenant (the /v1/payroll/runs default batch, previously
  // unordered) just to scan for the one row matching the previous month —
  // slow and wasteful with hundreds of runs, and silently wrong whenever
  // that row fell outside the fetched batch. Ask the backend for exactly
  // that one month instead.
  const prevIso = prevPeriodIso(run.payPeriod);
  // `previousGross` distinguishes "no prior run existed" (a real 0 — no
  // parseable previous period, or the fetch succeeded and simply found none)
  // from "the fetch for the prior run failed" (null) — a fetch failure must
  // not read as a fabricated ₹0 prior payroll in the MoM comparison below.
  let previousGross: number | null = 0;
  if (prevIso) {
    const { data: prevRuns, source: prevSource } = await getPayrollRunDetails({ limit: 1, month: prevIso });
    previousGross = prevSource === "error" ? null : (prevRuns[0]?.grossAmount ?? 0);
  }

  const slipRows = run.salarySlips as SalarySlipRow[];
  const exceptions = deriveExceptions(slipRows, t);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title", { period: run.payPeriod })}
        subtitle={t("subtitle", { date: formatIndianDate(run.runDate) })}
        back="/hr/payroll"
        backLabel="Payroll Runs"
      />
      <DataSourceBadge source={source} message={t("loadErrorMessage")} />

      {/* 5-step horizontal progress stepper */}
      <Card>
        <div style={{ padding: "4px 16px 0" }}>
          <PayrollRunStepper status={run.status} />
        </div>
      </Card>

      {/* KPI summary cards */}
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label={t("statEmployees")}  value={run.employeeCount.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label={t("statGross")}      value={formatRupees(run.grossAmount)} />
        <StatCard icon="📉" iconBg="var(--warnbg)" label={t("statDeductions")} value={formatRupees(run.deductions)} />
        <StatCard icon="✅" iconBg="var(--panel)"  label={t("statNetPay")}    value={formatRupees(run.netAmount)} />
      </StatGrid>

      {/* Month-over-Month KPI cards */}
      <MonthOverMonthCards
        currentGross={run.grossAmount}
        previousGross={previousGross}
        currentNet={run.netAmount}
        currentPeriod={run.payPeriod}
        previousPeriod={prevPeriodLabel(run.payPeriod)}
      />

      {/* Exception panel (amber warning) */}
      <ExceptionPanel exceptions={exceptions} />

      {/* Payroll lifecycle actions */}
      <PayrollRunActions
        runId={run.id}
        status={run.status}
        employeeCount={run.employeeCount}
        grossAmount={run.grossAmount}
        netAmount={run.netAmount}
        payPeriod={run.payPeriod}
        canAdminister={canAdminister}
      />

      <Card title={t("runDetailsTitle")}>
        <div className="fields">
          <div className="fld">
            <div className="l">{t("fieldPayPeriod")}</div>
            <div className="v">{run.payPeriod}</div>
          </div>
          <div className="fld">
            <div className="l">{t("fieldRunDate")}</div>
            <div className="v">{formatIndianDate(run.runDate)}</div>
          </div>
          <div className="fld">
            <div className="l">{t("fieldEmployeeCount")}</div>
            <div className="v">{run.employeeCount.toLocaleString("en-IN")}</div>
          </div>
          <div className="fld">
            <div className="l">{t("fieldStatus")}</div>
            <div className="v">
              <span className={`pill ${run.status === "paid" ? "good" : run.status === "draft" ? "mut" : run.status === "failed" ? "bad" : "warn"}`}>
                {run.status}
              </span>
            </div>
          </div>
          <div className="fld">
            <div className="l">{t("fieldGrossAmount")}</div>
            <div className="v">{formatRupees(run.grossAmount)}</div>
          </div>
          <div className="fld">
            <div className="l">{t("fieldDeductions")}</div>
            <div className="v">{formatRupees(run.deductions)}</div>
          </div>
          <div className="fld">
            <div className="l">{t("fieldNetAmount")}</div>
            <div className="v">{formatRupees(run.netAmount)}</div>
          </div>
        </div>
      </Card>

      {/* Salary slips with Preview Slip button per row */}
      <Card title={t("salarySlipsTitle", { count: slipRows.length })}>
        <div style={{ padding: "0 0 4px" }}>
          <SalarySlipsClientTable
            slips={slipRows}
            payPeriod={run.payPeriod}
          />
        </div>
      </Card>
    </div>
  );
}
