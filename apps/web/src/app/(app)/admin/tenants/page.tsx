import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function TenantsPage() {
  type Row = { name: string; edition: string; status: string; users: number; createdDate: string };

  const rows: Row[] = [
    { name: "Rajasthan Urban Development Authority", edition: "Government", status: "Active", users: 1250, createdDate: "2023-04-15" },
    { name: "Madhya Pradesh PWD", edition: "Government", status: "Active", users: 890, createdDate: "2023-06-01" },
    { name: "Gujarat Industrial Development Corp", edition: "PSU", status: "Active", users: 520, createdDate: "2023-08-20" },
    { name: "Haryana State Electronics Dev Corp", edition: "PSU", status: "Active", users: 340, createdDate: "2023-11-10" },
    { name: "Municipal Corp of Greater Mumbai (Demo)", edition: "Government", status: "Trial", users: 50, createdDate: "2025-01-15" },
    { name: "Chhattisgarh Housing Board", edition: "Small Office", status: "Active", users: 180, createdDate: "2024-02-01" },
    { name: "UP Jal Nigam", edition: "Government", status: "Suspended", users: 720, createdDate: "2023-09-15" },
    { name: "Kerala IT Mission", edition: "PSU", status: "Active", users: 410, createdDate: "2024-05-20" },
  ];

  const columns = [
    { key: "name" as const, label: "Tenant Name" },
    { key: "edition" as const, label: "Edition" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "users" as const, label: "Users", align: "right" as const },
    { key: "createdDate" as const, label: "Created" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tenants" subtitle="All registered tenants with edition, status and usage details." back="/admin" />
      <StatGrid>
        <StatCard icon="🏢" iconBg="#eef2ff" label="Total Tenants" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={6} />
        <StatCard icon="🧪" iconBg="#fffaeb" label="Trial" value={1} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Suspended" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Tenant Directory</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable rowLinkKey="name" rowLinkPrefix="/admin/tenants/" />
      </div>
    </main>
  );
}
