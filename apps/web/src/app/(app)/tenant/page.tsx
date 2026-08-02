import { ModuleHub } from "../../_components/ModuleHub";

export default function Page() {
  return (
    <ModuleHub
      title="Tenant"
      description="Tenant profile, quotas, settings, org hierarchy, subscriptions, code lists, positions, consent exchange, stewardship, data migration and plans."
      help="tenant-admin"
      links={[
        { href: "/tenant/overview", label: "Overview", note: "Current tenant profile and isolation posture" },
        { href: "/tenant/quotas", label: "Quotas & Usage", note: "Resource limits and consumption dashboard" },
        { href: "/tenant/settings", label: "Settings", note: "Tenant-scoped configuration keys" },
        { href: "/tenant/org-hierarchy", label: "Org Hierarchy", note: "Organisation units and subtree views" },
        { href: "/tenant/subscriptions", label: "Subscriptions", note: "Current subscription and lifecycle" },
        { href: "/tenant/plans", label: "Plans", note: "Available plans and feature comparison" },
        { href: "/tenant/code-lists", label: "Code Lists", note: "Reference codes and effective-dated values" },
        { href: "/tenant/positions", label: "Positions", note: "Position master and role bindings" },
        { href: "/tenant/consent-exchange", label: "Consent Exchange", note: "Cross-tenant consent requests and ledger" },
        { href: "/tenant/stewardship", label: "Stewardship", note: "Data governance domains and stewards" },
        { href: "/tenant/data-migration", label: "Data Migration", note: "Org migrations and reconciliation" },
      ]}
    />
  );
}
