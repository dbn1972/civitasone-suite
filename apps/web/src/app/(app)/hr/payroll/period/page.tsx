import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { getPayrollRunDetails } from "@/app/_data/loaders";
import type { PayrollRunDetail } from "@civitasone/types";

// This page used to call GET /api/v1/finance/periods -- Finance's GL
// period-close endpoint, gated to finance_officer/finance_admin/super_admin
// and backed by open/soft_close/hard_close period rows, none of which carry
// this page's own Row shape (month/runDate/employeesProcessed/grossPayout/
// netPayout/deductions/status). That endpoint returns 200 with an empty/
// unrelated shape rather than erroring, so the mismatch was silent: every
// prominent "Start Run"/"Run Payroll" CTA across the HR dashboard funnelled
// here, to a page that could never show real payroll-run data even when the
// request "succeeded". Switched to the same getPayrollRunDetails() loader
// (GET /api/v1/payroll/runs) the working /hr/payroll root page already
// uses -- this Row shape (month/runDate/employeesProcessed/grossPayout/...)
// was always describing a payroll run, just fetched from the wrong service.

const inrFmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });

type Row = {
  id: string;
  month: string;
  runDate: string;
  employeesProcessed: number;
  grossPayout: string;
  netPayout: string;
  deductions: string;
  status: string;
};

function toRow(run: PayrollRunDetail): Row {
  // IMPORTANT: PayrollRunDetail's grossAmount/netAmount/deductions are
  // already rupees (payroll-service divides the minor-unit total before
  // returning it) -- pre-format them as display strings here rather than
  // using DataTable's cellType:"amount", which calls formatMoney() and
  // expects minor units. Using cellType:"amount" on an already-rupee value
  // would silently divide it by 100 again (see the same warning in
  // hr/payroll/disbursement/page.tsx, which reads the exact same schema).
  return {
    id: run.id,
    month: run.payPeriod,
    runDate: run.runDate,
    employeesProcessed: run.employeeCount,
    grossPayout: inrFmt.format(run.grossAmount),
    netPayout: inrFmt.format(run.netAmount),
    deductions: inrFmt.format(run.deductions),
    status: run.status,
  };
}

export default async function PayrollPeriodPage() {
  const { data: runs, source } = await getPayrollRunDetails();
  const items = runs.map(toRow);

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "month", label: "Month" },
    { key: "runDate", label: "Run Date" },
    { key: "employeesProcessed", label: "Employees", align: "right" },
    { key: "grossPayout", label: "Gross", align: "right" },
    { key: "netPayout", label: "Net Payout", align: "right" },
    { key: "deductions", label: "Deductions", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Payroll Periods" subtitle="Monthly payroll run history and processing status." back="/hr" />
      <DataSourceBadge source={source} message="Couldn't load payroll periods — showing nothing" />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--infobg)" label="Total" value={items.length} />
        <StatCard icon="✅" iconBg="var(--goodbg)" label="Completed" value={items.filter((i) => i.status === "completed" || i.status === "paid").length} />
        <StatCard icon="⏳" iconBg="var(--warnbg)" label="Processing" value={items.filter((i) => i.status === "processing" || i.status === "draft").length} />
        <StatCard icon="👥" iconBg="var(--infobg)" label="Total Employees" value={items.reduce((s, i) => s + (Number(i.employeesProcessed) || 0), 0).toLocaleString("en-IN")} />
      </StatGrid>
      <Card title="Payroll Periods">
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by period or status…" pageSize={15} emptyIcon="📅" emptyTitle="No payroll periods yet" emptyMessage="Payroll periods are created automatically each time a payroll run is processed. Run your first payroll from the Payroll page to generate a period record." />
      </Card>
    </main>
  );
}
