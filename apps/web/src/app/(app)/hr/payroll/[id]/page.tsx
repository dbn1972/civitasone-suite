import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, Card, DataTable, StatusPill } from "../../../../_components/ds";
import { getPayrollRunById } from "../../../../_data/loaders";
import { PayrollRunActions } from "./PayrollRunActions";

function fmtAmount(minorUnits: number) {
  return `₹${(minorUnits / 100).toLocaleString("en-IN")}`;
}

type SalarySlipRow = {
  id: string;
  employeeId: string;
  employeeName: string;
  gross: number;
  deductions: number;
  net: number;
  status: string;
};

export default async function PayrollRunDetailPage({ params }: { params: { id: string } }) {
  const { data: run, source } = await getPayrollRunById(params.id);

  if (!run) {
    return (
      <>
        <PageHeader title="Payroll Run" back="/hr/payroll" />
        {source === "error" && <DataSourceBadge source="error" />}
        <Card padding>
          <p className="text-center text-slate-400">Payroll run not found.</p>
        </Card>
      </>
    );
  }

  const slipColumns: { key: keyof SalarySlipRow & string; label: string; align?: "left" | "right"; render?: (row: SalarySlipRow) => React.ReactNode }[] = [
    { key: "employeeName", label: "Employee" },
    { key: "gross", label: "Gross", align: "right", render: (r) => fmtAmount(r.gross) },
    { key: "deductions", label: "Deductions", align: "right", render: (r) => fmtAmount(r.deductions) },
    { key: "net", label: "Net", align: "right", render: (r) => fmtAmount(r.net) },
    {
      key: "status",
      label: "Status",
      render: (r) => <StatusPill status={r.status} />,
    },
  ];

  return (
    <>
      <PageHeader title="Payroll Run" back="/hr/payroll" />
      {source === "error" && <DataSourceBadge source="error" />}
      <PayrollRunActions runId={run.id} status={run.status} />
      <Card title="Run Details" padding>
        <div className="fields">
          <div className="field">
            <span className="lbl">Pay Period</span>
            <span className="val">{run.payPeriod}</span>
          </div>
          <div className="field">
            <span className="lbl">Run Date</span>
            <span className="val">{run.runDate}</span>
          </div>
          <div className="field">
            <span className="lbl">Employee Count</span>
            <span className="val">{run.employeeCount.toLocaleString("en-IN")}</span>
          </div>
          <div className="field">
            <span className="lbl">Status</span>
            <span className="val"><StatusPill status={run.status} /></span>
          </div>
          <div className="field">
            <span className="lbl">Gross Amount</span>
            <span className="val">{fmtAmount(run.grossAmount)}</span>
          </div>
          <div className="field">
            <span className="lbl">Deductions</span>
            <span className="val">{fmtAmount(run.deductions)}</span>
          </div>
          <div className="field">
            <span className="lbl">Net Amount</span>
            <span className="val">{fmtAmount(run.netAmount)}</span>
          </div>
        </div>
      </Card>
      <Card title={`Salary Slips (${run.salarySlips.length})`}>
        <DataTable<SalarySlipRow>
          columns={slipColumns}
          rows={run.salarySlips}
        />
      </Card>
    </>
  );
}
