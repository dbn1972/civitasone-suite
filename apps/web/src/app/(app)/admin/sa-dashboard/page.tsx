import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function SaDashboardPage() {
  type Row = { metric: string; category: string; value: string; change: string; period: string; status: string };

  const rows: Row[] = [
    { metric: "Monthly Recurring Revenue", category: "Revenue", value: "₹42,50,000", change: "+8.2%", period: "Feb 2025", status: "On Track" },
    { metric: "Active Tenants", category: "Growth", value: "148", change: "+12", period: "Feb 2025", status: "On Track" },
    { metric: "Total Users (All Tenants)", category: "Usage", value: "12,450", change: "+340", period: "Feb 2025", status: "Growing" },
    { metric: "API Uptime", category: "Reliability", value: "99.97%", change: "+0.02%", period: "Last 30 days", status: "Healthy" },
    { metric: "Avg. Response Time (p95)", category: "Performance", value: "245ms", change: "-12ms", period: "Last 7 days", status: "Healthy" },
    { metric: "Support Tickets Open", category: "Support", value: "23", change: "-5", period: "Current", status: "Improving" },
    { metric: "Storage Utilisation", category: "Infrastructure", value: "68%", change: "+3%", period: "Feb 2025", status: "Warning" },
  ];

  const columns = [
    { key: "metric" as const, label: "Metric" },
    { key: "category" as const, label: "Category" },
    { key: "value" as const, label: "Value" },
    { key: "change" as const, label: "Change" },
    { key: "period" as const, label: "Period" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Super Admin Dashboard" subtitle="Platform-wide health, revenue and growth overview." back="/admin" />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Active Tenants" value={148} />
        <StatCard icon="👥" iconBg="#ecfdf3" label="Total Users" value="12,450" />
        <StatCard icon="💰" iconBg="#fffaeb" label="MRR" value="₹42.5L" />
        <StatCard icon="💚" iconBg="#fce7ee" label="Platform Health" value="99.97%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Platform KPIs</h3></div>
        <DataTable columns={columns} rows={rows} sortable />
      </div>
    </main>
  );
}
