import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function OperatorsPage() {
  type Row = { name: string; role: string; lastLogin: string; twoFaStatus: string; permissions: string };

  const rows: Row[] = [
    { name: "Anand Krishnamurthy", role: "Super Admin", lastLogin: "2025-02-10 09:15", twoFaStatus: "Enabled", permissions: "Full Access" },
    { name: "Priya Menon", role: "Platform Engineer", lastLogin: "2025-02-10 08:45", twoFaStatus: "Enabled", permissions: "Infrastructure + Deploy" },
    { name: "Rahul Sharma", role: "Support Lead", lastLogin: "2025-02-09 17:30", twoFaStatus: "Enabled", permissions: "Read + Tenant Support" },
    { name: "Deepika Patel", role: "Billing Admin", lastLogin: "2025-02-08 14:20", twoFaStatus: "Enabled", permissions: "Billing + Invoices" },
    { name: "Vijay Nair", role: "DevOps Engineer", lastLogin: "2025-02-10 07:00", twoFaStatus: "Enabled", permissions: "Infrastructure + Monitoring" },
    { name: "Sneha Gupta", role: "Security Analyst", lastLogin: "2025-02-09 11:45", twoFaStatus: "Enabled", permissions: "Audit + Security" },
    { name: "Manoj Kumar (Inactive)", role: "Platform Engineer", lastLogin: "2024-12-15 10:30", twoFaStatus: "Disabled", permissions: "Suspended" },
  ];

  const columns = [
    { key: "name" as const, label: "Name" },
    { key: "role" as const, label: "Role" },
    { key: "lastLogin" as const, label: "Last Login" },
    { key: "twoFaStatus" as const, label: "2FA Status", cellType: "status" as const },
    { key: "permissions" as const, label: "Permissions" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Platform Operators" subtitle="Super admin and platform team accounts with access controls." back="/admin" />
      <StatGrid>
        <StatCard icon="👤" iconBg="#eef2ff" label="Total Operators" value={7} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={6} />
        <StatCard icon="🔐" iconBg="#fffaeb" label="2FA Enabled" value={6} />
        <StatCard icon="⛔" iconBg="#fce7ee" label="Suspended" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Operator Directory</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
