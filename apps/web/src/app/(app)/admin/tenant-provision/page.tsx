import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { ProvisionStepsTable, type ProvisionStep } from "./ProvisionStepsTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

type Step = ProvisionStep;

// Static reference: documents the steps a new tenant goes through. There is
// no provisioning wizard yet (GAP-ADMIN-TENANT-PROVISION-01) -- the page used
// to promise one in its subtitle while offering no action at all. No
// fetch/save in this file: it is read-only documentation, not tenant state.
// GAP-ADMIN-TENANT-PROVISION-02: the per-row template-readiness status and the
// "Templates Ready" tile were removed -- nothing ever checked that readiness,
// so both asserted a state the code cannot know.
const PROVISIONING_STEPS: Step[] = [
  { step: 1, name: "Organisation Details", description: "Name, address, GSTIN, contact person, phone, email", required: "Yes" },
  { step: 2, name: "Edition Selection", description: "Choose Small Office, PSU, or Government edition", required: "Yes" },
  { step: 3, name: "Module Configuration", description: "Select modules to enable for the tenant", required: "Yes" },
  { step: 4, name: "Admin User Setup", description: "Create primary admin account with role assignment", required: "Yes" },
  { step: 5, name: "Domain & Branding", description: "Subdomain assignment, logo, colour scheme", required: "Optional" },
  { step: 6, name: "Data Migration", description: "Import historical data from legacy systems", required: "Optional" },
  { step: 7, name: "Integration Setup", description: "Configure PFMS, GeM, DigiLocker integrations", required: "Optional" },
  { step: 8, name: "Go-Live Checklist", description: "Final verification, UAT sign-off, DNS switch", required: "Yes" },
];

export default function TenantProvisionPage() {
  // Platform-operator screen -- gate before rendering so an unauthorized
  // caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Tenant Provisioning" area="tenant provisioning" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const required = PROVISIONING_STEPS.filter((s) => s.required === "Yes").length;
  const optional = PROVISIONING_STEPS.filter((s) => s.required === "Optional").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Tenant Provisioning"
        subtitle="Reference: the steps a new tenant goes through. The guided wizard is not available yet."
        back="/admin"
        actions={
          <Link className="btn ghost" href="/admin/onboarding">
            Open onboarding queue
          </Link>
        }
      />
      <StatGrid>
        <StatCard icon="🚀" iconBg="#eef2ff" label="Total Steps" value={PROVISIONING_STEPS.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Required" value={required} />
        <StatCard icon="⚙️" iconBg="#fffaeb" label="Optional" value={optional} />
      </StatGrid>
      <Card title="Provisioning Steps (reference)">
        <ProvisionStepsTable steps={PROVISIONING_STEPS} />
      </Card>
    </div>
  );
}
