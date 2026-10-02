import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAEditions } from "@/app/_data/loaders";
import { EditionsTable } from "./EditionsTable";
import { AdminAccessDenied, sessionHasAnyRole } from "../_components/AdminAccessGate";
import { PLATFORM_ADMIN_ROLES } from "@/lib/auth/adminRoles";

export default async function EditionsPage() {
  // GAP-ADMIN-EDITIONS-01: platform-operator screen -- gate before any loader runs so an
  // unauthorized caller sees "Access restricted", not operator chrome.
  if (!sessionHasAnyRole(PLATFORM_ADMIN_ROLES)) {
    return <AdminAccessDenied title="Edition Catalog" area="the edition catalog" roles={PLATFORM_ADMIN_ROLES} />;
  }
  const { data: editions, source } = await getSAEditions();
  const active = editions.filter((e) => String(e.status).toLowerCase() === "active").length;
  const totalTenants = editions.reduce((s, e) => s + Number(e.tenants ?? 0), 0);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside EditionsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Edition Catalog" subtitle="Platform editions with module bundles, pricing and tenant allocation." back="/admin" />
      <StatGrid>
        <StatCard icon="📦" iconBg="#eef2ff" label="Total Editions" value={editions.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="🏢" iconBg="#fffaeb" label="Total Tenants" value={totalTenants} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Deprecated" value={editions.length - active} />
      </StatGrid>
      <Card title="Editions">
        <EditionsTable editions={editions} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
