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

export default async function PayrollRunDetailPage({ params }: { params: { id: string } }) {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => ["payroll_admin", "payroll_officer", "super_admin"].includes(r));
  const { data: run, source } = await getPayrollRunById(params.id);

  if (!run) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Payroll Run" back="/hr/payroll" backLabel="Payroll Runs" />
        <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0" }}>
            Payroll run not found. It may have been removed or you may not have access.
          </p>
        </Card>
      </main>
    );
  }

  /* MoM: fetch all runs to find the previous month's gross */
  const { data: allRuns } = await getPayrollRunDetails();
  const thisParsed = parsePeriod(run.payPeriod);
  const prevRun = allRuns.find((r) => {
    if (r.id === run.id) return false;
    const p = parsePeriod(r.payPeriod);
    if (!p || !thisParsed) return false;
    const prevMonth = thisParsed.month === 1 ? 12 : thisParsed.month - 1;
    const prevYear  = thisParsed.month === 1 ? thisParsed.year - 1 : thisParsed.year;
    return p.year === prevYear && p.month === prevMonth;
  });
  const previousGross = prevRun?.grossAmount ?? 0;

  const slipRows = run.salarySlips as SalarySlipRow[];
  const exceptions = deriveExceptions(slipRows);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Payroll Run — ${run.payPeriod}`}
        subtitle={`Run dated ${formatIndianDate(run.runDate)}`}
        back="/hr/payroll"
        backLabel="Payroll Runs"
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      {/* 5-step horizontal progress stepper */}
      <Card>
        <div style={{ padding: "4px 16px 0" }}>
          <PayrollRunStepper status={run.status} />
        </div>
      </Card>

      {/* KPI summary cards */}
      <StatGrid>
        <StatCard icon="👥" iconBg="var(--infobg)" label="Employees"  value={run.employeeCount.toLocaleString("en-IN")} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label="Gross"      value={formatRupees(run.grossAmount)} />
        <StatCard icon="📉" iconBg="var(--warnbg)" label="Deductions" value={formatRupees(run.deductions)} />
        <StatCard icon="✅" iconBg="var(--panel)"  label="Net Pay"    value={formatRupees(run.netAmount)} />
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

      <Card title="Run Details">
        <div className="fields">
          <div className="fld">
            <div className="l">Pay Period</div>
            <div className="v">{run.payPeriod}</div>
          </div>
          <div className="fld">
            <div className="l">Run Date</div>
            <div className="v">{formatIndianDate(run.runDate)}</div>
          </div>
          <div className="fld">
            <div className="l">Employee Count</div>
            <div className="v">{run.employeeCount.toLocaleString("en-IN")}</div>
          </div>
          <div className="fld">
            <div className="l">Status</div>
            <div className="v">
              <span className={`pill ${run.status === "paid" ? "good" : run.status === "draft" ? "mut" : run.status === "failed" ? "bad" : "warn"}`}>
                {run.status}
              </span>
            </div>
          </div>
          <div className="fld">
            <div className="l">Gross Amount</div>
            <div className="v">{formatRupees(run.grossAmount)}</div>
          </div>
          <div className="fld">
            <div className="l">Deductions</div>
            <div className="v">{formatRupees(run.deductions)}</div>
          </div>
          <div className="fld">
            <div className="l">Net Amount</div>
            <div className="v">{formatRupees(run.netAmount)}</div>
          </div>
        </div>
      </Card>

      {/* Salary slips with Preview Slip button per row */}
      <Card title={`Salary Slips (${slipRows.length})`}>
        <div style={{ padding: "0 0 4px" }}>
          <SalarySlipsClientTable
            slips={slipRows}
            payPeriod={run.payPeriod}
            exceptionCount={exceptions.length}
          />
        </div>
      </Card>
    </main>
  );
}
