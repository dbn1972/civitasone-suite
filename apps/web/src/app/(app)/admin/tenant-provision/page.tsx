import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function TenantProvisionPage() {
  type Row = { step: number; name: string; description: string; required: string; status: string };

  const rows: Row[] = [
    { step: 1, name: "Organisation Details", description: "Name, address, GSTIN, contact person, phone, email", required: "Yes", status: "Template Ready" },
    { step: 2, name: "Edition Selection", description: "Choose Small Office, PSU, or Government edition", required: "Yes", status: "Template Ready" },
    { step: 3, name: "Module Configuration", description: "Select modules to enable for the tenant", required: "Yes", status: "Template Ready" },
    { step: 4, name: "Admin User Setup", description: "Create primary admin account with role assignment", required: "Yes", status: "Template Ready" },
    { step: 5, name: "Domain & Branding", description: "Subdomain assignment, logo, colour scheme", required: "Optional", status: "Template Ready" },
    { step: 6, name: "Data Migration", description: "Import historical data from legacy systems", required: "Optional", status: "Template Ready" },
    { step: 7, name: "Integration Setup", description: "Configure PFMS, GeM, DigiLocker integrations", required: "Optional", status: "Template Ready" },
    { step: 8, name: "Go-Live Checklist", description: "Final verification, UAT sign-off, DNS switch", required: "Yes", status: "Template Ready" },
  ];

  const columns = [
    { key: "step" as const, label: "Step", align: "center" as const },
    { key: "name" as const, label: "Step Name" },
    { key: "description" as const, label: "Description" },
    { key: "required" as const, label: "Required" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tenant Provisioning" subtitle="Step-by-step wizard for onboarding new tenants to the platform." back="/admin" />
      <StatGrid>
        <StatCard icon="🚀" iconBg="#eef2ff" label="Total Steps" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Required" value={5} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="Optional" value={3} />
        <StatCard icon="📋" iconBg="#fce7ee" label="Templates Ready" value={8} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Provisioning Steps</h3></div>
        <DataTable columns={columns} rows={rows} />
      </div>
    </main>
  );
}
