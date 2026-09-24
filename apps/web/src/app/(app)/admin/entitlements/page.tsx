import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAEntitlements } from "@/app/_data/loaders";
import { EntitlementsTable } from "./EntitlementsTable";

export default async function EntitlementsPage() {
  const { data: entitlements, source } = await getSAEntitlements();
  const active = entitlements.filter((e) => String(e.status).toLowerCase() === "active").length;

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      {/* UX-012: the data-source badge now lives inside EntitlementsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <PageHeader title="Entitlements" subtitle="Module and feature entitlements per edition and tenant override." back="/admin" />
      <StatGrid>
        <StatCard icon="🔑" iconBg="#eef2ff" label="Total Entitlements" value={entitlements.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Active" value={active} />
        <StatCard icon="⛔" iconBg="#fffaeb" label="Revoked" value={entitlements.length - active} />
        <StatCard icon="📦" iconBg="#eff6ff" label="Editions" value={new Set(entitlements.map((e) => String(e.edition ?? ""))).size} />
      </StatGrid>
      <Card title="Entitlement Matrix">
        <EntitlementsTable entitlements={entitlements} source={source === "error" ? "error" : "api"} />
      </Card>
    </div>
  );
}
