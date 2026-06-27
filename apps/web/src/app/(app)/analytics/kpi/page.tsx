import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function KpiPage() {
  type Row = { kpiName: string; category: string; currentValue: string; target: string; trend: string; owner: string };

  const rows: Row[] = [
    { kpiName: "Budget Utilisation Rate", category: "Finance", currentValue: "78%", target: "85%", trend: "↑ +3%", owner: "Dir. Finance" },
    { kpiName: "Procurement Cycle Time", category: "Procurement", currentValue: "42 days", target: "30 days", trend: "↓ -5 days", owner: "Dir. Procurement" },
    { kpiName: "Citizen Grievance Resolution", category: "Citizen Services", currentValue: "4.2 days", target: "3 days", trend: "↓ -0.8 days", owner: "Commissioner" },
    { kpiName: "Revenue Collection Efficiency", category: "Revenue", currentValue: "92%", target: "95%", trend: "↑ +2%", owner: "Dir. Revenue" },
    { kpiName: "Employee Attendance Rate", category: "HR", currentValue: "94.5%", target: "96%", trend: "↑ +0.5%", owner: "Dir. HR" },
    { kpiName: "Project On-Time Delivery", category: "Projects", currentValue: "68%", target: "80%", trend: "↑ +5%", owner: "Chief Engineer" },
    { kpiName: "Digital Transaction Ratio", category: "IT", currentValue: "72%", target: "90%", trend: "↑ +8%", owner: "CIO" },
    { kpiName: "Audit Para Settlement Rate", category: "Audit", currentValue: "74%", target: "90%", trend: "↑ +4%", owner: "Dir. Audit" },
  ];

  const columns = [
    { key: "kpiName" as const, label: "KPI Name" },
    { key: "category" as const, label: "Category" },
    { key: "currentValue" as const, label: "Current Value" },
    { key: "target" as const, label: "Target" },
    { key: "trend" as const, label: "Trend" },
    { key: "owner" as const, label: "Owner" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="KPI Library" subtitle="Organisation-wide Key Performance Indicators with targets and trends." back="/analytics" />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#eef2ff" label="Total KPIs" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Target" value={3} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Below Target" value={5} />
        <StatCard icon="📈" iconBg="#fce7ee" label="Improving" value={7} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>KPI Register</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
