import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  amount: string;
  purpose: string;
  requestDate: string;
  recoverySchedule: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", amount: "₹50,000", purpose: "Medical Emergency", requestDate: "05/06/2024", recoverySchedule: "5 instalments", status: "approved" },
  { id: "2", employee: "Priya Sharma", department: "HR", amount: "₹30,000", purpose: "Personal", requestDate: "12/06/2024", recoverySchedule: "3 instalments", status: "active" },
  { id: "3", employee: "Amit Patel", department: "IT", amount: "₹75,000", purpose: "Transfer Expenses", requestDate: "20/06/2024", recoverySchedule: "6 instalments", status: "pending" },
  { id: "4", employee: "Sunita Rao", department: "Legal", amount: "₹25,000", purpose: "Festival", requestDate: "01/05/2024", recoverySchedule: "2 instalments", status: "completed" },
  { id: "5", employee: "Vikram Singh", department: "Admin", amount: "₹40,000", purpose: "Medical", requestDate: "15/07/2024", recoverySchedule: "4 instalments", status: "pending" },
  { id: "6", employee: "Meera Iyer", department: "Accounts", amount: "₹60,000", purpose: "Personal", requestDate: "28/05/2024", recoverySchedule: "6 instalments", status: "active" },
];

export default function AdvancesPage() {
  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const totalAmount = "₹2,80,000";

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "amount", label: "Amount" },
    { key: "purpose", label: "Purpose" },
    { key: "requestDate", label: "Request Date" },
    { key: "recoverySchedule", label: "Recovery" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Salary Advances" subtitle="Employee salary advance requests and recovery schedules." back="/hr" />
      <StatGrid>
        <StatCard icon="💸" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="▶️" iconBg="#e6f7f0" label="Active Recovery" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="💰" iconBg="#f5f5f5" label="Total Disbursed" value={totalAmount} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Advances Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or purpose…" pageSize={15} />
      </div>
    </main>
  );
}
