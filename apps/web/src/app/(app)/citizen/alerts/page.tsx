import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function AlertsPage() {
  type Row = { title: string; category: string; publishedDate: string; targetAudience: string; status: string };

  const rows: Row[] = [
    { title: "Water supply disruption – Ward 12-15", category: "Utility", publishedDate: "2025-02-10", targetAudience: "Ward 12-15 Residents", status: "Active" },
    { title: "Property tax deadline extended to March 31", category: "Revenue", publishedDate: "2025-02-08", targetAudience: "All Property Owners", status: "Active" },
    { title: "Road closure – NH-48 maintenance", category: "Traffic", publishedDate: "2025-02-05", targetAudience: "Commuters", status: "Active" },
    { title: "COVID vaccination camp at PHC Sector 7", category: "Health", publishedDate: "2025-02-01", targetAudience: "All Citizens", status: "Expired" },
    { title: "Monsoon preparedness advisory", category: "Disaster Mgmt", publishedDate: "2025-01-28", targetAudience: "Low-lying Areas", status: "Draft" },
    { title: "Aadhaar seeding camp for pension beneficiaries", category: "Social Welfare", publishedDate: "2025-01-25", targetAudience: "Pensioners", status: "Active" },
    { title: "Public hearing – Master Plan 2041", category: "Urban Planning", publishedDate: "2025-01-20", targetAudience: "All Citizens", status: "Expired" },
  ];

  const columns = [
    { key: "title" as const, label: "Title" },
    { key: "category" as const, label: "Category" },
    { key: "publishedDate" as const, label: "Published" },
    { key: "targetAudience" as const, label: "Target Audience" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Public Alerts & Notifications" subtitle="Broadcast alerts and targeted notifications for citizens." back="/citizen" />
      <StatGrid>
        <StatCard icon="🔔" iconBg="#eef2ff" label="Active Alerts" value={4} />
        <StatCard icon="📤" iconBg="#ecfdf3" label="Published This Month" value={3} />
        <StatCard icon="👁️" iconBg="#fffaeb" label="Total Reach" value="45,200" />
        <StatCard icon="📝" iconBg="#fce7ee" label="Drafts" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Alerts & Notifications</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
