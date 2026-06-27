import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  goal: string;
  kra: string;
  target: string;
  actual: string;
  cycle: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", goal: "Process 500 bills/quarter", kra: "Operational Efficiency", target: "500", actual: "480", cycle: "2024-25 Q1", status: "active" },
  { id: "2", employee: "Priya Sharma", goal: "Reduce onboarding TAT to 3 days", kra: "Process Improvement", target: "3 days", actual: "2.5 days", cycle: "2024-25 Q1", status: "completed" },
  { id: "3", employee: "Amit Patel", goal: "Deploy 3 modules on time", kra: "Project Delivery", target: "3", actual: "2", cycle: "2024-25 Q1", status: "active" },
  { id: "4", employee: "Sunita Rao", goal: "Clear 95% legal opinions within SLA", kra: "Service Delivery", target: "95%", actual: "92%", cycle: "2024-25 Q1", status: "active" },
  { id: "5", employee: "Vikram Singh", goal: "Digitise 10,000 legacy records", kra: "Digital Transformation", target: "10,000", actual: "7,500", cycle: "2024-25 Q1", status: "overdue" },
  { id: "6", employee: "Meera Iyer", goal: "Conduct 4 financial audits", kra: "Compliance", target: "4", actual: "4", cycle: "2024-25 Q1", status: "completed" },
  { id: "7", employee: "Deepak Kumar", goal: "Train 50 staff on ERP", kra: "Capacity Building", target: "50", actual: "35", cycle: "2024-25 Q1", status: "active" },
];

export default function GoalsPage() {
  const completed = items.filter((i) => i.status === "completed").length;
  const active = items.filter((i) => i.status === "active").length;
  const overdue = items.filter((i) => i.status === "overdue").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "goal", label: "Goal" },
    { key: "kra", label: "KRA" },
    { key: "target", label: "Target" },
    { key: "actual", label: "Actual" },
    { key: "cycle", label: "Cycle" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Goals & KRAs" subtitle="Performance goals for current appraisal cycle with targets and actuals." back="/hr" />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e6f0ff" label="Total Goals" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
        <StatCard icon="▶️" iconBg="#fffbe6" label="In Progress" value={active} />
        <StatCard icon="⚠️" iconBg="#fff0f0" label="Overdue" value={overdue} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Goals List</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, goal or KRA…" pageSize={15} />
      </div>
    </main>
  );
}
