import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  fromDate: string;
  toDate: string;
  days: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Amit Patel", department: "IT", fromDate: "22/07/2024", toDate: "24/07/2024", days: "3", reason: "Internet infra work at office", status: "approved" },
  { id: "2", employee: "Deepak Kumar", department: "IT", fromDate: "25/07/2024", toDate: "26/07/2024", days: "2", reason: "System deployment — remote monitoring", status: "approved" },
  { id: "3", employee: "Priya Sharma", department: "HR", fromDate: "29/07/2024", toDate: "29/07/2024", days: "1", reason: "Document review", status: "pending" },
  { id: "4", employee: "Rajesh Verma", department: "Finance", fromDate: "01/08/2024", toDate: "02/08/2024", days: "2", reason: "Quarter-end reconciliation", status: "pending" },
  { id: "5", employee: "Rahul Mehra", department: "IT", fromDate: "15/07/2024", toDate: "16/07/2024", days: "2", reason: "Code review sprint", status: "approved" },
  { id: "6", employee: "Sneha Kulkarni", department: "Finance", fromDate: "18/07/2024", toDate: "18/07/2024", days: "1", reason: "Personal appointment — half WFH", status: "rejected" },
  { id: "7", employee: "Vikram Singh", department: "Admin", fromDate: "05/08/2024", toDate: "05/08/2024", days: "1", reason: "Maintenance coordination", status: "pending" },
];

export default function WfhPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "days", label: "Days" },
    { key: "reason", label: "Reason" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Work From Home Requests" subtitle="WFH requests and approval status." back="/hr" />
      <StatGrid>
        <StatCard icon="🏠" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>WFH Requests</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…" pageSize={15} />
      </div>
    </main>
  );
}
