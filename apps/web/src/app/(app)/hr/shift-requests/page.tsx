import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  currentShift: string;
  requestedShift: string;
  effectiveDate: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rahul Mehra", department: "IT", currentShift: "General Shift", requestedShift: "Flexible Shift", effectiveDate: "01/08/2024", reason: "Part-time course", status: "approved" },
  { id: "2", employee: "Sneha Kulkarni", department: "Finance", currentShift: "General Shift", requestedShift: "Morning Shift", effectiveDate: "05/08/2024", reason: "Childcare", status: "pending" },
  { id: "3", employee: "Arjun Nair", department: "IT Ops", currentShift: "Evening Shift", requestedShift: "General Shift", effectiveDate: "10/08/2024", reason: "Health", status: "approved" },
  { id: "4", employee: "Karan Joshi", department: "Security", currentShift: "Night Shift", requestedShift: "Morning Shift", effectiveDate: "15/08/2024", reason: "Personal", status: "pending" },
  { id: "5", employee: "Pooja Saxena", department: "Admin", currentShift: "General Shift", requestedShift: "Flexible Shift", effectiveDate: "01/09/2024", reason: "WFH days", status: "rejected" },
  { id: "6", employee: "Nikhil Gupta", department: "Data Centre", currentShift: "Night Shift", requestedShift: "Evening Shift", effectiveDate: "20/08/2024", reason: "Rotation request", status: "pending" },
];

export default function ShiftRequestsPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "currentShift", label: "Current Shift" },
    { key: "requestedShift", label: "Requested Shift" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "reason", label: "Reason" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Shift Change Requests" subtitle="Employee requests to change assigned shifts." back="/hr" />
      <StatGrid>
        <StatCard icon="🔄" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Shift Change Requests</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, shift or status…" pageSize={15} />
      </div>
    </main>
  );
}
