import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function DataWarehousePage() {
  type Row = { dataset: string; lastRefresh: string; records: string; size: string; qualityScore: string; status: string };

  const rows: Row[] = [
    { dataset: "Finance – GL Transactions", lastRefresh: "2025-02-10 06:00", records: "12,45,890", size: "4.2 GB", qualityScore: "98%", status: "Healthy" },
    { dataset: "HR – Employee Master", lastRefresh: "2025-02-10 06:00", records: "24,560", size: "180 MB", qualityScore: "96%", status: "Healthy" },
    { dataset: "Procurement – Purchase Orders", lastRefresh: "2025-02-10 06:00", records: "3,45,210", size: "1.8 GB", qualityScore: "94%", status: "Healthy" },
    { dataset: "Citizen – Service Requests", lastRefresh: "2025-02-09 23:00", records: "8,90,450", size: "3.1 GB", qualityScore: "89%", status: "Warning" },
    { dataset: "Revenue – Tax Collections", lastRefresh: "2025-02-10 06:00", records: "5,67,800", size: "2.4 GB", qualityScore: "97%", status: "Healthy" },
    { dataset: "Projects – Milestones", lastRefresh: "2025-02-09 18:00", records: "1,23,450", size: "890 MB", qualityScore: "91%", status: "Healthy" },
    { dataset: "Audit – Event Log", lastRefresh: "2025-02-10 06:00", records: "45,67,230", size: "8.5 GB", qualityScore: "99%", status: "Healthy" },
    { dataset: "Grants – Disbursements", lastRefresh: "2025-02-08 06:00", records: "78,900", size: "320 MB", qualityScore: "82%", status: "Stale" },
  ];

  const columns = [
    { key: "dataset" as const, label: "Dataset" },
    { key: "lastRefresh" as const, label: "Last Refresh" },
    { key: "records" as const, label: "Records", align: "right" as const },
    { key: "size" as const, label: "Size", align: "right" as const },
    { key: "qualityScore" as const, label: "Quality Score" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Data Warehouse" subtitle="Consolidated datasets, refresh schedules and data quality metrics." back="/analytics" />
      <StatGrid>
        <StatCard icon="🗄️" iconBg="#eef2ff" label="Total Datasets" value={8} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Total Records" value="78.6M" />
        <StatCard icon="💾" iconBg="#fffaeb" label="Storage Used" value="21.4 GB" />
        <StatCard icon="✅" iconBg="#fce7ee" label="Avg. Quality" value="93%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Dataset Inventory</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
