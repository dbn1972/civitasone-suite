import { ModuleHub } from "../../_components/ModuleHub";
import { LABELS } from "@/lib/labels";

export default function Page() {
  return (
    <ModuleHub
      title={`${LABELS.tenantTitle} administration`}
      description="Profile, quotas, settings, org hierarchy, subscriptions, plans and governance for your organisation."
      help="tenant-admin"
      links={[
        { href: "/tenant/overview", label: "Overview", icon: "🏢", note: "Current office profile and isolation posture" },
        { href: "/tenant/quotas", label: "Quotas & Usage", icon: "📊", note: "Resource limits and consumption dashboard" },
        { href: "/tenant/settings", label: "Settings", icon: "⚙️", note: "Office-scoped configuration keys" },
        { href: "/tenant/org-hierarchy", label: "Org Hierarchy", icon: "🌳", note: "Organisation units and subtree views" },
        { href: "/tenant/subscriptions", label: "Subscriptions", icon: "🧾", note: "Current subscription and lifecycle" },
        { href: "/tenant/plans", label: "Plans", icon: "📦", note: "Available plans and feature comparison" },
        { href: "/tenant/code-lists", label: "Code Lists", icon: "📒", note: "Reference codes and their dated values" },
        { href: "/tenant/positions", label: "Positions", icon: "🪪", note: "Position master and role bindings" },
        { href: "/tenant/consent-exchange", label: "Consent Exchange", icon: "🤝", note: "Cross-organisation consent requests" },
        { href: "/tenant/stewardship", label: "Stewardship", icon: "🛡️", note: "Data governance domains and stewards" },
        { href: "/tenant/data-migration", label: "Data Migration", icon: "🔁", note: "Org migrations and reconciliation" },
        // GAP-TENANT-HOME-02: visible cross-link to the Tenant Admin area, which
        // shares the plans/org-hierarchy/settings/usage concerns. Previously the
        // only link to it was the disabled-module fallback in ModuleGate.
        { href: "/tenant-admin", label: "Admin Console", icon: "🧰", note: "Users, roles, security and subscription admin" },
      ]}
    />
  );
}
