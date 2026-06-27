import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  grossIncome: string;
  deductions80C: string;
  otherDeductions: string;
  taxableIncome: string;
  taxPayable: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", grossIncome: "₹18,50,000", deductions80C: "₹1,50,000", otherDeductions: "₹75,000", taxableIncome: "₹16,25,000", taxPayable: "₹2,73,000", status: "completed" },
  { id: "2", employee: "Priya Sharma", department: "HR", grossIncome: "₹14,20,000", deductions80C: "₹1,50,000", otherDeductions: "₹50,000", taxableIncome: "₹12,20,000", taxPayable: "₹1,77,000", status: "completed" },
  { id: "3", employee: "Amit Patel", department: "IT", grossIncome: "₹16,80,000", deductions80C: "₹1,50,000", otherDeductions: "₹1,00,000", taxableIncome: "₹14,30,000", taxPayable: "₹2,34,000", status: "completed" },
  { id: "4", employee: "Sunita Rao", department: "Legal", grossIncome: "₹15,60,000", deductions80C: "₹1,20,000", otherDeductions: "₹60,000", taxableIncome: "₹13,80,000", taxPayable: "₹2,19,000", status: "pending" },
  { id: "5", employee: "Vikram Singh", department: "Admin", grossIncome: "₹12,00,000", deductions80C: "₹1,50,000", otherDeductions: "₹25,000", taxableIncome: "₹10,25,000", taxPayable: "₹1,15,000", status: "completed" },
  { id: "6", employee: "Deepak Kumar", department: "IT", grossIncome: "₹11,40,000", deductions80C: "₹1,00,000", otherDeductions: "₹50,000", taxableIncome: "₹9,90,000", taxPayable: "₹1,04,000", status: "pending" },
];

export default function IncomeTaxPage() {
  const computed = items.filter((i) => i.status === "completed").length;
  const pending = items.filter((i) => i.status === "pending").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "employee", label: "Employee" },
    { key: "grossIncome", label: "Gross Income", align: "right" },
    { key: "deductions80C", label: "80C", align: "right" },
    { key: "otherDeductions", label: "Other Ded.", align: "right" },
    { key: "taxableIncome", label: "Taxable Income", align: "right" },
    { key: "taxPayable", label: "Tax Payable", align: "right" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Income Tax Computation" subtitle="Annual IT computation summary for FY 2024-25." back="/hr" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label="Total Employees" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Computed" value={computed} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="FY" value="2024-25" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>IT Computation Summary</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…" pageSize={15} />
      </div>
    </main>
  );
}
