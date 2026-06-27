import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  department: string;
  sanctionedPosts: string;
  filled: string;
  vacant: string;
  fillPercentage: string;
  lastReview: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", department: "Finance", sanctionedPosts: "45", filled: "38", vacant: "7", fillPercentage: "84%", lastReview: "01/04/2024", status: "active" },
  { id: "2", department: "HR", sanctionedPosts: "20", filled: "18", vacant: "2", fillPercentage: "90%", lastReview: "01/04/2024", status: "active" },
  { id: "3", department: "IT", sanctionedPosts: "60", filled: "52", vacant: "8", fillPercentage: "87%", lastReview: "01/04/2024", status: "active" },
  { id: "4", department: "Legal", sanctionedPosts: "15", filled: "12", vacant: "3", fillPercentage: "80%", lastReview: "01/04/2024", status: "active" },
  { id: "5", department: "Procurement", sanctionedPosts: "25", filled: "21", vacant: "4", fillPercentage: "84%", lastReview: "01/04/2024", status: "active" },
  { id: "6", department: "Admin", sanctionedPosts: "35", filled: "32", vacant: "3", fillPercentage: "91%", lastReview: "01/04/2024", status: "active" },
  { id: "7", department: "Accounts", sanctionedPosts: "30", filled: "27", vacant: "3", fillPercentage: "90%", lastReview: "01/04/2024", status: "active" },
];

export default function StaffingPlanPage() {
  const totalSanctioned = items.reduce((s, i) => s + parseInt(i.sanctionedPosts), 0);
  const totalFilled = items.reduce((s, i) => s + parseInt(i.filled), 0);
  const totalVacant = items.reduce((s, i) => s + parseInt(i.vacant), 0);
  const overallFill = Math.round((totalFilled / totalSanctioned) * 100);

  const columns: { key: keyof Row & string; label: string; cellType?: "status"; align?: "left" | "right" }[] = [
    { key: "department", label: "Department" },
    { key: "sanctionedPosts", label: "Sanctioned", align: "right" },
    { key: "filled", label: "Filled", align: "right" },
    { key: "vacant", label: "Vacant", align: "right" },
    { key: "fillPercentage", label: "Fill %" },
    { key: "lastReview", label: "Last Review" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Staffing Plan" subtitle="Department-wise sanctioned posts, filled positions, and vacancies." back="/hr" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e6f0ff" label="Sanctioned" value={totalSanctioned} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Filled" value={totalFilled} />
        <StatCard icon="🔲" iconBg="#fffbe6" label="Vacant" value={totalVacant} />
        <StatCard icon="📈" iconBg="#f5f5f5" label="Fill Rate" value={`${overallFill}%`} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Staffing Plan by Department</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by department…" pageSize={15} />
      </div>
    </main>
  );
}
