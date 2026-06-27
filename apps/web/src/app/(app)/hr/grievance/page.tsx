import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  category: string;
  filedDate: string;
  assignedTo: string;
  description: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "GR-2024-001", employee: "Karan Joshi", department: "Procurement", category: "Workplace Harassment", filedDate: "05/06/2024", assignedTo: "Priya Sharma", description: "Inappropriate remarks by senior", status: "active" },
  { id: "GR-2024-002", employee: "Pooja Saxena", department: "Admin", category: "Pay Discrepancy", filedDate: "12/06/2024", assignedTo: "Rajesh Verma", description: "HRA not credited for 2 months", status: "completed" },
  { id: "GR-2024-003", employee: "Nikhil Gupta", department: "Accounts", category: "Transfer Grievance", filedDate: "20/06/2024", assignedTo: "Director HR", description: "Hardship transfer without consent", status: "active" },
  { id: "GR-2024-004", employee: "Divya Pillai", department: "Legal", category: "Working Conditions", filedDate: "01/07/2024", assignedTo: "Vikram Singh", description: "Inadequate workspace and seating", status: "pending" },
  { id: "GR-2024-005", employee: "Sneha Kulkarni", department: "Finance", category: "Promotion Denial", filedDate: "10/07/2024", assignedTo: "Committee", description: "Passed over despite seniority", status: "pending" },
  { id: "GR-2024-006", employee: "Arjun Nair", department: "HR", category: "Leave Denial", filedDate: "15/07/2024", assignedTo: "Director HR", description: "Child care leave rejected unfairly", status: "pending" },
];

export default function GrievancePage() {
  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const resolved = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "id", label: "Case ID" },
    { key: "employee", label: "Employee" },
    { key: "category", label: "Category" },
    { key: "filedDate", label: "Filed Date" },
    { key: "assignedTo", label: "Assigned To" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Grievance Redressal" subtitle="Employee grievances, category tracking, and resolution status." back="/hr" />
      <StatGrid>
        <StatCard icon="📢" iconBg="#e6f0ff" label="Total Grievances" value={items.length} />
        <StatCard icon="▶️" iconBg="#fffbe6" label="Under Inquiry" value={active} />
        <StatCard icon="⏳" iconBg="#fff0f0" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Resolved" value={resolved} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Grievance Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, category or case ID…" pageSize={15} />
      </div>
    </main>
  );
}
