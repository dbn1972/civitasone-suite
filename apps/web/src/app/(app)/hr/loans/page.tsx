import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  loanType: string;
  sanctionedAmount: string;
  emi: string;
  balance: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", loanType: "House Building Advance", sanctionedAmount: "₹25,00,000", emi: "₹18,500", balance: "₹19,50,000", status: "active" },
  { id: "2", employee: "Priya Sharma", department: "HR", loanType: "Motor Car Advance", sanctionedAmount: "₹7,50,000", emi: "₹12,000", balance: "₹3,60,000", status: "active" },
  { id: "3", employee: "Amit Patel", department: "IT", loanType: "Computer Advance", sanctionedAmount: "₹1,00,000", emi: "₹5,000", balance: "₹25,000", status: "active" },
  { id: "4", employee: "Sunita Rao", department: "Legal", loanType: "Festival Advance", sanctionedAmount: "₹30,000", emi: "₹3,000", balance: "₹0", status: "completed" },
  { id: "5", employee: "Vikram Singh", department: "Admin", loanType: "House Building Advance", sanctionedAmount: "₹20,00,000", emi: "₹15,000", balance: "₹18,00,000", status: "active" },
  { id: "6", employee: "Deepak Kumar", department: "IT", loanType: "Motor Car Advance", sanctionedAmount: "₹8,00,000", emi: "—", balance: "—", status: "pending" },
];

export default function LoansPage() {
  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "loanType", label: "Loan Type" },
    { key: "sanctionedAmount", label: "Sanctioned" },
    { key: "emi", label: "EMI" },
    { key: "balance", label: "Balance" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Employee Loans" subtitle="Loans sanctioned, EMI recovery, and outstanding balances." back="/hr" />
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f0ff" label="Total Loans" value={items.length} />
        <StatCard icon="▶️" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#f5f5f5" label="Closed" value={completed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Loans Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, loan type or status…" pageSize={15} />
      </div>
    </main>
  );
}
