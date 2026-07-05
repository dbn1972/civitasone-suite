import { PageHeader, StatGrid, StatCard, Card, DataTable } from "@/app/_components/ds";

type Step = { step: number; name: string; description: string; required: string; status: string; [k: string]: unknown };

const PROVISIONING_STEPS: Step[] = [
  { step: 1, name: "Organisation Details", description: "Name, address, GSTIN, contact person, phone, email", required: "Yes", status: "Template Ready" },
  { step: 2, name: "Edition Selection", description: "Choose Small Office, PSU, or Government edition", required: "Yes", status: "Template Ready" },
  { step: 3, name: "Module Configuration", description: "Select modules to enable for the tenant", required: "Yes", status: "Template Ready" },
  { step: 4, name: "Admin User Setup", description: "Create primary admin account with role assignment", required: "Yes", status: "Template Ready" },
  { step: 5, name: "Domain & Branding", description: "Subdomain assignment, logo, colour scheme", required: "Optional", status: "Template Ready" },
  { step: 6, name: "Data Migration", description: "Import historical data from legacy systems", required: "Optional", status: "Template Ready" },
  { step: 7, name: "Integration Setup", description: "Configure PFMS, GeM, DigiLocker integrations", required: "Optional", status: "Template Ready" },
  { step: 8, name: "Go-Live Checklist", description: "Final verification, UAT sign-off, DNS switch", required: "Yes", status: "Template Ready" },
];

export default function TenantProvisionPage() {
  const required = PROVISIONING_STEPS.filter((s) => s.required === "Yes").length;
  const optional = PROVISIONING_STEPS.filter((s) => s.required === "Optional").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tenant Provisioning" subtitle="Step-by-step wizard for onboarding new tenants to the platform." back="/admin" />
      <StatGrid>
        <StatCard icon="🚀" iconBg="#eef2ff" label="Total Steps" value={PROVISIONING_STEPS.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Required" value={required} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="Optional" value={optional} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Templates Ready" value={PROVISIONING_STEPS.length} />
      </StatGrid>
      <Card title="Provisioning Steps">
        <DataTable<Step>
          columns={[
            { key: "step", label: "Step", align: "center" },
            { key: "name", label: "Step Name" },
            { key: "description", label: "Description" },
            { key: "required", label: "Required" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
          rows={PROVISIONING_STEPS}
          sortable
          emptyIcon="🚀"
          emptyTitle="No steps"
          emptyMessage="Provisioning steps not configured."
        />
      </Card>
    </main>
  );
}
