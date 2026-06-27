import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  period: string;
  periodType: string;
  tasksCompleted: string;
  rating: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", period: "01/07 – 07/07/2024", periodType: "Weekly", tasksCompleted: "12/14", rating: "4/5", status: "approved" },
  { id: "2", employee: "Priya Sharma", department: "HR", period: "01/07 – 07/07/2024", periodType: "Weekly", tasksCompleted: "8/8", rating: "5/5", status: "approved" },
  { id: "3", employee: "Amit Patel", department: "IT", period: "01/07 – 31/07/2024", periodType: "Monthly", tasksCompleted: "45/50", rating: "4/5", status: "pending" },
  { id: "4", employee: "Sunita Rao", department: "Legal", period: "08/07 – 14/07/2024", periodType: "Weekly", tasksCompleted: "6/7", rating: "4/5", status: "approved" },
  { id: "5", employee: "Vikram Singh", department: "Admin", period: "01/07 – 31/07/2024", periodType: "Monthly", tasksCompleted: "30/38", rating: "3/5", status: "pending" },
  { id: "6", employee: "Deepak Kumar", department: "IT", period: "15/07 – 21/07/2024", periodType: "Weekly", tasksCompleted: "10/10", rating: "5/5", status: "approved" },
  { id: "7", employee: "Meera Iyer", department: "Accounts", period: "15/07 – 21/07/2024", periodType: "Weekly", tasksCompleted: "9/11", rating: "—", status: "pending" },
];

export default function WorkSummaryPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const weekly = items.filter((i) => i.periodType === "Weekly").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "period", label: "Period" },
    { key: "periodType", label: "Type" },
    { key: "tasksCompleted", label: "Tasks" },
    { key: "rating", label: "Rating" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Work Summaries" subtitle="Weekly and monthly work summary submissions with supervisor ratings." back="/hr" />
      <StatGrid>
        <StatCard icon="📝" iconBg="#e6f0ff" label="Total Summaries" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Reviewed" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Review" value={pending} />
        <StatCard icon="📅" iconBg="#f5f5f5" label="Weekly" value={weekly} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Work Summaries</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, period or status…" pageSize={15} />
      </div>
    </main>
  );
}
