import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  probationEnd: string;
  dueDate: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rahul Mehra", department: "IT", joiningDate: "01/01/2024", probationEnd: "30/06/2024", dueDate: "15/07/2024", status: "pending" },
  { id: "2", employee: "Sneha Kulkarni", department: "Finance", joiningDate: "15/12/2023", probationEnd: "14/06/2024", dueDate: "30/06/2024", status: "approved" },
  { id: "3", employee: "Arjun Nair", department: "HR", joiningDate: "01/02/2024", probationEnd: "31/07/2024", dueDate: "15/08/2024", status: "pending" },
  { id: "4", employee: "Divya Pillai", department: "Legal", joiningDate: "10/11/2023", probationEnd: "09/05/2024", dueDate: "25/05/2024", status: "completed" },
  { id: "5", employee: "Karan Joshi", department: "Procurement", joiningDate: "20/03/2024", probationEnd: "19/09/2024", dueDate: "05/10/2024", status: "pending" },
  { id: "6", employee: "Pooja Saxena", department: "Admin", joiningDate: "05/10/2023", probationEnd: "04/04/2024", dueDate: "20/04/2024", status: "overdue" },
];

export default function ConfirmationPage() {
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const overdue = items.filter((i) => i.status === "overdue").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "joiningDate", label: "Joining Date" },
    { key: "probationEnd", label: "Probation Ends" },
    { key: "dueDate", label: "Confirmation Due" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Probation Confirmations" subtitle="Employees due for confirmation after probation period." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Due" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Confirmed" value={approved} />
        <StatCard icon="⚠️" iconBg="#fff0f0" label="Overdue" value={overdue} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Confirmation Queue</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…" pageSize={15} />
      </div>
    </main>
  );
}
