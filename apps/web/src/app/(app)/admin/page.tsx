import type { NavTile } from "@civitasone/types";
import { LinkTiles } from "../../_components/LinkTiles";
import { PageHeader } from "../../_components/ds";
import { serverT } from "@/lib/i18n/server";

const adminTiles: NavTile[] = [
  { title: "SA Dashboard", href: "/admin/sa-dashboard", description: "Platform health, revenue and growth" },
  { title: "Tenants", href: "/admin/tenants", description: "Tenant directory and management" },
  { title: "Tenant Provisioning", href: "/admin/tenant-provision", description: "New tenant onboarding wizard" },
  { title: "Onboarding Queue", href: "/admin/onboarding", description: "Pending tenant onboarding requests" },
  { title: "Metering", href: "/admin/metering", description: "Per-tenant usage and billing" },
  { title: "Invoices", href: "/admin/invoices", description: "Billing invoices and payments" },
  { title: "Editions", href: "/admin/editions", description: "Edition catalog and module bundles" },
  { title: "Entitlements", href: "/admin/entitlements", description: "Module limits and overrides" },
  { title: "Feature Flags", href: "/admin/feature-flags", description: "Feature toggles and rollout" },
  { title: "Integrations", href: "/admin/integrations", description: "External endpoints, API keys and connections" },
  { title: "Operators", href: "/admin/operators", description: "Platform team accounts" },
  { title: "Gateways", href: "/admin/gateways", description: "Communication gateway status" },
  { title: "API Monitoring", href: "/admin/api-monitoring", description: "Endpoint health and latency" },
  { title: "Tech Admin", href: "/admin/tech-admin", description: "Services, deploys and scaling" },
  { title: "Tenant Admin", href: "/tenant-admin", description: "Per-tenant administration panel" },
];

export default function AdminPage() {
  const t = serverT();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader title={t("admin.title")} subtitle={t("admin.subtitle")} />
      <LinkTiles tiles={adminTiles} columns="four" />
    </main>
  );
}
