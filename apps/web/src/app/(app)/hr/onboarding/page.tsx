import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  joiningDate: string;
  stepsCompleted: string;
  totalSteps: string;
  progress: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rahul Mehra", department: "IT", joiningDate: "01/07/2024", stepsCompleted: "8", totalSteps: "10", progress: "80%", status: "active" },
  { id: "2", employee: "Sneha Kulkarni", department: "Finance", joiningDate: "15/06/2024", stepsCompleted: "10", totalSteps: "10", progress: "100%", status: "completed" },
  { id: "3", employee: "Arjun Nair", department: "HR", joiningDate: "10/07/2024", stepsCompleted: "3", totalSteps: "10", progress: "30%", status: "active" },
  { id: "4", employee: "Divya Pillai", department: "Legal", joiningDate: "20/07/2024", stepsCompleted: "1", totalSteps: "10", progress: "10%", status: "active" },
  { id: "5", employee: "Karan Joshi", department: "Procurement", joiningDate: "01/06/2024", stepsCompleted: "10", totalSteps: "10", progress: "100%", status: "completed" },
  { id: "6", employee: "Pooja Saxena", department: "Admin", joiningDate: "05/07/2024", stepsCompleted: "5", totalSteps: "10", progress: "50%", status: "active" },
  { id: "7", employee: "Nikhil Gupta", department: "Accounts", joiningDate: "25/07/2024", stepsCompleted: "0", totalSteps: "10", progress: "0%", status: "pending" },
];

export default function OnboardingPage() {
  const active = items.filter((i) => i.status === "active").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const pending = items.filter((i) => i.status === "pending").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "New Joinee" },
    { key: "department", label: "Department" },
    { key: "joiningDate", label: "Joining Date" },
    { key: "stepsCompleted", label: "Steps Done" },
    { key: "progress", label: "Progress" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Onboarding Tracker" subtitle="Onboarding checklist progress for new joinees." back="/hr" />
      <StatGrid>
        <StatCard icon="🚀" iconBg="#e6f0ff" label="Total Joinees" value={items.length} />
        <StatCard icon="▶️" iconBg="#fffbe6" label="In Progress" value={active} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
        <StatCard icon="⏳" iconBg="#f5f5f5" label="Not Started" value={pending} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Onboarding Status</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or department…" pageSize={15} />
      </div>
    </main>
  );
}
