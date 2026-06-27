import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function OnboardingPage() {
  type Row = { org: string; contact: string; requested: string; assigned: string; stage: string };

  const rows: Row[] = [
    { org: "Bihar State Road Transport Corp", contact: "Sh. Arvind Mishra", requested: "2025-02-08", assigned: "Priya Menon", stage: "Document Collection" },
    { org: "Odisha Mining Corporation", contact: "Smt. Lata Panda", requested: "2025-02-05", assigned: "Rahul Sharma", stage: "Edition Selection" },
    { org: "Punjab Water Supply Board", contact: "Sh. Gurpreet Singh", requested: "2025-02-01", assigned: "Priya Menon", stage: "Module Configuration" },
    { org: "Assam State Transport Corp", contact: "Sh. Bhaskar Deka", requested: "2025-01-28", assigned: "Deepika Patel", stage: "Admin Setup" },
    { org: "Jharkhand Urban Infra Dev Co", contact: "Smt. Rekha Soren", requested: "2025-01-25", assigned: "Rahul Sharma", stage: "UAT" },
    { org: "Telangana State Housing Corp", contact: "Sh. Narasimha Reddy", requested: "2025-01-20", assigned: "Vijay Nair", stage: "Go-Live Pending" },
    { org: "Uttarakhand Jal Sansthan", contact: "Sh. Manoj Rawat", requested: "2025-02-10", assigned: "Unassigned", stage: "New Request" },
  ];

  const columns = [
    { key: "org" as const, label: "Organisation" },
    { key: "contact" as const, label: "Contact" },
    { key: "requested" as const, label: "Requested" },
    { key: "assigned" as const, label: "Assigned To" },
    { key: "stage" as const, label: "Stage", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tenant Onboarding Queue" subtitle="New tenant requests and onboarding pipeline status." back="/admin" />
      <StatGrid>
        <StatCard icon="📥" iconBg="#eef2ff" label="In Queue" value={7} />
        <StatCard icon="🆕" iconBg="#ecfdf3" label="New Requests" value={1} />
        <StatCard icon="🔄" iconBg="#fffaeb" label="In Progress" value={5} />
        <StatCard icon="🚀" iconBg="#fce7ee" label="Ready for Go-Live" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Onboarding Pipeline</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
