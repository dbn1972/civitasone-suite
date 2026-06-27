import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";

type Row = {
  id: string;
  month: string;
  runDate: string;
  employeesProcessed: string;
  grossPayout: string;
  netPayout: string;
  deductions: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", month: "July 2024", runDate: "28/07/2024", employeesProcessed: "475", grossPayout: "₹3,82,00,000", netPayout: "₹2,95,00,000", deductions: "₹87,00,000", status: "completed" },
  { id: "2", month: "June 2024", runDate: "28/06/2024", employeesProcessed: "472", grossPayout: "₹3,78,00,000", netPayout: "₹2,92,00,000", deductions: "₹86,00,000", status: "completed" },
  { id: "3", month: "May 2024", runDate: "28/05/2024", employeesProcessed: "470", grossPayout: "₹3,76,00,000", netPayout: "₹2,90,00,000", deductions: "₹86,00,000", status: "completed" },
  { id: "4", month: "April 2024", runDate: "28/04/2024", employeesProcessed: "468", grossPayout: "₹3,74,00,000", netPayout: "₹2,89,00,000", deductions: "₹85,00,000", status: "completed" },
  { id: "5", month: "August 2024", runDate: "—", employeesProcessed: "—", grossPayout: "—", netPayout: "—", deductions: "—", status: "pending" },
  { id: "6", month: "March 2024", runDate: "28/03/2024", employeesProcessed: "465", grossPayout: "₹3,72,00,000", netPayout: "₹2,88,00,000", deductions: "₹84,00,000", status: "completed" },
];

export default function PayrollPeriodPage() {
  const completed = items.filter((i) => i.status === "completed").length;
  const pending = items.filter((i) => i.status === "pending").length;

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
      <StatGrid>
        <StatCard icon="📅" iconBg="#e6f0ff" label="Total Periods" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Processed" value={completed} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="👥" iconBg="#f5f5f5" label="Current Headcount" value="475" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Payroll Periods</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by month or status…" pageSize={15} />
      </div>
    </main>
  );
}
