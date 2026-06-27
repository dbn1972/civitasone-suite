import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, DataTable } from "../../../../_components/ds";
import { getPayrollRunById } from "../../../../_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { PayrollRunActions } from "./PayrollRunActions";

type SalarySlipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  gross: number;
  deductions: number;
  net: number;
  status: string;
} & Record<string, unknown>;

export default async function PayrollRunDetailPage({ params }: { params: { id: string } }) {
  const { data: run, source } = await getPayrollRunById(params.id);

  if (!run) {
    return (
      <>
        <PageHeader title="Payroll Run" back="/hr/payroll" backLabel="Payroll Runs" />
        {source === "error" && <DataSourceBadge source="error" />}
        <Card padding>
          <p style={{ textAlign: "center", color: "var(--mut)", padding: "24px 0" }}>
            Payroll run not found. It may have been removed or you may not have access.
          </p>
        </Card>
      </>
    );
  }

  const slipColumns: {
    key: keyof SalarySlipRow & string;
    label: string;
    align?: "left" | "right";
    cellType?: "status" | "amount";
  }[] = [
    { key: "employeeName", label: "Employee" },
    { key: "gross", label: "Gross", align: "right", cellType: "amount" },
    { key: "deductions", label: "Deductions", align: "right", cellType: "amount" },
    { key: "net", label: "Net", align: "right", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  const slipRows = run.salarySlips as SalarySlipRow[];

  return (
    <>
      <PageHeader
        title={`Payroll Run — ${run.payPeriod}`}
        subtitle={`Run dated ${formatIndianDate(run.runDate)}`}
        back="/hr/payroll"
        backLabel="Payroll Runs"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <PayrollRunActions
        runId={run.id}
        status={run.status}
        employeeCount={run.employeeCount}
        grossAmount={run.grossAmount}
        netAmount={run.netAmount}
        payPeriod={run.payPeriod}
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
              <span className={`pill ${run.status === "disbursed" ? "good" : run.status === "draft" ? "mut" : run.status === "failed" ? "bad" : "warn"}`}>
                {run.status}
              </span>
            </div>
          </div>
          <div className="fld">
            <div className="l">Gross Amount</div>
            <div className="v">{formatMoney(run.grossAmount)}</div>
          </div>
          <div className="fld">
            <div className="l">Deductions</div>
            <div className="v">{formatMoney(run.deductions)}</div>
          </div>
          <div className="fld">
            <div className="l">Net Amount</div>
            <div className="v">{formatMoney(run.netAmount)}</div>
          </div>
        </div>
      </Card>
      <Card title={`Salary Slips (${slipRows.length})`}>
        <DataTable<SalarySlipRow>
          columns={slipColumns}
          rows={slipRows}
          sortable
          filterable
          filterPlaceholder="Filter by employee or status…"
          pageSize={15}
          rowLinkKey="employeeId"
          rowLinkPrefix="/hr/employees/"
        />
      </Card>
    </>
  );
}
